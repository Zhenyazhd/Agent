import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { AddressInfo } from './types.js';

export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || join(process.cwd(), 'WORKSPACE');
export const BYTECODES_DIR = join(WORKSPACE_DIR, 'bytecodes');

function ensureWorkspace() {
  if (!existsSync(WORKSPACE_DIR)) {
    mkdirSync(WORKSPACE_DIR, { recursive: true });
  }
}

function ensureBytecodes() {
  ensureWorkspace();
  if (!existsSync(BYTECODES_DIR)) {
    mkdirSync(BYTECODES_DIR, { recursive: true });
  }
}

export function getAddressFilePath(address: string, chainId: number): string {
  const normalizedAddress = address.toLowerCase();
  return join(WORKSPACE_DIR, `${chainId}_${normalizedAddress}.json`);
}

export function getBytecodeFilePath(address: string): string {
  return join(BYTECODES_DIR, `${address.toLowerCase()}.json`);
}

export function saveBytecodesSeparately(
  address: string,
  bytecode?: string,
  implementationBytecode?: string,
): void {
  if (!bytecode && !implementationBytecode) return;
  ensureBytecodes();
  const filePath = getBytecodeFilePath(address);
  const data: Record<string, string> = {};
  if (bytecode) data.bytecode = bytecode;
  if (implementationBytecode) data.implementationBytecode = implementationBytecode;
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function loadCachedAddress(address: string, chainId: number): AddressInfo | null {
  const filePath = getAddressFilePath(address, chainId);
  if (existsSync(filePath)) {
    try {
      const data = readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

export function saveAddressInfo(info: AddressInfo): void {
  ensureWorkspace();

  if (info.bytecode || info.implementationBytecode) {
    saveBytecodesSeparately(info.address, info.bytecode, info.implementationBytecode);
  }

  const toSave = { ...info };
  if (toSave.sourceCode) {
    delete toSave.bytecode;
    delete toSave.implementationBytecode;
  }

  const filePath = getAddressFilePath(info.address, info.chainId);
  writeFileSync(filePath, JSON.stringify(toSave, null, 2));
}