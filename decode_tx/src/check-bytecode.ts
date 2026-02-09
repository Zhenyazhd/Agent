#!/usr/bin/env node
import { checkBytecode, checkBytecodes, checkBytecodesInDirectory, decompileAndSave, type BytecodeCheckResult } from './bytecode-checker.js';
import { existsSync, statSync } from 'fs';

function printResult(result: BytecodeCheckResult, verbose: boolean = false, shortPath: boolean = false): void {
  if (result.error) {
    const path = shortPath ? result.filePath.split('/').pop() || result.filePath : result.filePath;
    console.error(`${path}: ${result.error}`);
    return;
  }

  const path = shortPath ? result.filePath.split('/').pop() || result.filePath : result.filePath;

  if (result.hasSourceCode) {
    console.log(`✓ ${path}: sourceCode (bytecode not needed)`);
    return;
  }

  if (result.hasImplementationBytecode) {
    console.log(`✓ ${path}: impl-bytecode${result.hasBytecode ? ' (also has bytecode)' : ''}`);
    if (verbose && result.implementationBytecode) {
      const length = result.implementationBytecode.length;
      console.log(`  implementationBytecode: ${result.implementationBytecode.slice(0, 20)}... (${length} chars)`);
      if (result.bytecode) {
        const bytecodeLength = result.bytecode.length;
        console.log(`  bytecode: ${result.bytecode.slice(0, 20)}... (${bytecodeLength} chars)`);
      }
    }
  } else if (result.hasBytecode) {
    console.log(`✓ ${path}: bytecode`);
    if (verbose && result.bytecode) {
      const length = result.bytecode.length;
      console.log(`  bytecode: ${result.bytecode.slice(0, 20)}... (${length} chars)`);
    }
  } else {
    console.log(`✗ ${path}: no bytecode found`);
  }
}

function printSummary(results: BytecodeCheckResult[]): void {
  const total = results.length;
  const withSourceCode = results.filter(r => r.hasSourceCode).length;
  const withImplBytecode = results.filter(r => r.hasImplementationBytecode && !r.hasSourceCode).length;
  const withBytecodeOnly = results.filter(r => r.hasBytecode && !r.hasImplementationBytecode && !r.hasSourceCode).length;
  const withBoth = results.filter(r => r.hasBytecode && r.hasImplementationBytecode && !r.hasSourceCode).length;
  const withPrimaryBytecode = results.filter(r => r.primaryBytecode).length;
  const errors = results.filter(r => r.error).length;

  console.log('\n=== Summary ===');
  console.log(`Total files: ${total}`);
  if (withSourceCode > 0) {
    console.log(`With sourceCode: ${withSourceCode} (bytecode not needed)`);
  }
  console.log(`With primary bytecode: ${withPrimaryBytecode} (impl-bytecode: ${withImplBytecode}, bytecode-only: ${withBytecodeOnly})`);
  if (withBoth > 0) {
    console.log(`With both bytecode types: ${withBoth}`);
  }
  if (errors > 0) {
    console.log(`Errors: ${errors}`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Bytecode Checker - проверяет наличие bytecode или implementationBytecode в JSON файлах

Usage:
  npm run check-bytecode <path1> [path2] [path3] ... [options]

Arguments:
  paths    Пути к файлам и/или директориям с JSON файлами (можно несколько)

Options:
  -r, --recursive      Проверять файлы рекурсивно в поддиректориях
  -v, --verbose        Показать детальную информацию о bytecode
  -j, --json           Вывести результат в формате JSON
  --no-decompile       Не декомпилировать bytecode с помощью heimdall
  -h, --help           Показать эту справку

Examples:
  npm run check-bytecode ./WORKSPACE/1_0x1234.json
  npm run check-bytecode ./WORKSPACE
  npm run check-bytecode ./WORKSPACE --verbose
  npm run check-bytecode ./WORKSPACE --json
  npm run check-bytecode ./WORKSPACE --no-decompile  # Не декомпилировать
`);
    process.exit(0);
  }

  const verbose = args.includes('--verbose') || args.includes('-v');
  const jsonOutput = args.includes('--json') || args.includes('-j');
  const recursive = args.includes('--recursive') || args.includes('-r');
  const decompile = !args.includes('--no-decompile');

  const paths = args
    .filter(arg => !arg.startsWith('--') && !arg.startsWith('-'))
    .flatMap(arg => arg.split(','))
    .map(p => p.trim())
    .filter(p => p.length > 0);

  if (paths.length === 0) {
    console.error('Error: Please provide at least one file or directory path');
    process.exit(1);
  }

  let results: BytecodeCheckResult[] = [];

  try {
    const { readdirSync } = await import('fs');
    const { join } = await import('path');

    function findJsonFiles(dir: string, fileList: string[] = []): string[] {
      try {
        const files = readdirSync(dir);
        files.forEach(file => {
          const filePath = join(dir, file);
          try {
            const fileStat = statSync(filePath);
            if (fileStat.isDirectory()) {
              findJsonFiles(filePath, fileList);
            } else if (file.endsWith('.json')) {
              fileList.push(filePath);
            }
          } catch {
          }
        });
      } catch {
      }
      return fileList;
    }

    for (const p of paths) {
      if (!existsSync(p)) {
        console.error(`Warning: Path not found: ${p}`);
        continue;
      }

      const stats = statSync(p);

      if (stats.isFile()) {
        results.push(checkBytecode(p));
      } else if (stats.isDirectory()) {
        if (recursive) {
          results.push(...checkBytecodes(findJsonFiles(p)));
        } else {
          results.push(...checkBytecodesInDirectory(p));
        }
      }
    }

    if (decompile) {
      for (const result of results) {
        if (!result.error && !result.hasSourceCode && result.primaryBytecode) {
          console.log(`[Decompiling] ${result.filePath.split('/').pop()}...`);
          const success = await decompileAndSave(result.filePath, result.primaryBytecode);
          if (success) {
            result.hasSourceCode = true;
            console.log(`  ✓ Decompiled and saved to ${result.filePath}`);
          } else {
            console.log(`  ✗ Decompilation failed`);
          }
        }
      }
    }

    if (jsonOutput) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      const shortPath = results.length > 1;
      results.forEach(result => printResult(result, verbose, shortPath));
      if (results.length > 1) {
        printSummary(results);
      }
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
