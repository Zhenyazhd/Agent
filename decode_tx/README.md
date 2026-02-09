# decode_for_agent

Утилиты для декодирования транзакций, резолва адресов и анализа bytecode. Работают через `cast` (Foundry) и публичные API.

## Установка

```bash
npm install
cp .env.example .env
# Заполнить .env своими ключами
```

## Команды

### decode:deep — декодирование транзакции

```bash
npm run decode:deep -- <tx_hash> [chain_id] [options]
```

Опции:
- `-o, --output <file>` — сохранить JSON в файл
- `-p, --pretty` — красивый вывод trace
- `-m, --meta` — обогатить метаданными контрактов (медленнее)
- `-j, --json` — вывести JSON в stdout

Примеры:
```bash
npm run decode:deep -- 0xabc...123 1
npm run decode:deep -- 0xabc...123 1 -p -o trace.json
npm run decode:deep -- 0xabc...123 137 --meta --pretty
```

### resolve — резолв адресов

```bash
npm run resolve -- <addresses> [chain_id] [options]
```

Принимает адреса через запятую или путь к JSON-файлу. Определяет контракт/EOA, скачивает ABI и исходники, детектит прокси.

Опции:
- `--no-cache` — не использовать кеш
- `--no-abi` — не качать ABI
- `--no-type` — не определять тип контракта
- `-v, --verbose` — подробный вывод
- `-j, --json` — JSON в stdout

Примеры:
```bash
npm run resolve -- 0x1234...abcd 1
npm run resolve -- 0x1234...abcd,0x5678...efgh 1
npm run resolve -- 0x1234...abcd 1 --json
```

Результаты сохраняются в `WORKSPACE/{chainId}_{address}.json`.

### check-bytecode — проверка и декомпиляция bytecode

```bash
npm run check-bytecode -- <file_or_directory> [options]
```

Проверяет наличие bytecode в JSON-файлах и декомпилирует через [heimdall](https://github.com/Jon-Becker/heimdall-rs) если нет исходников.

Опции:
- `-r, --recursive` — рекурсивный поиск
- `-v, --verbose` — подробный вывод
- `-j, --json` — JSON в stdout
- `--no-decompile` — не декомпилировать

Примеры:
```bash
npm run check-bytecode -- ./WORKSPACE/1_0x1234.json
npm run check-bytecode -- ./WORKSPACE
npm run check-bytecode -- ./WORKSPACE --no-decompile
```

## Поддерживаемые сети

| Chain ID | Сеть |
|----------|------|
| 1 | Ethereum |
| 137 | Polygon |
| 42161 | Arbitrum |
| 10 | Optimism |
| 8453 | Base |
| 56 | BSC |
| 43114 | Avalanche |

## Зависимости

- [Foundry](https://book.getfoundry.sh/) (`cast`) — для `decode:deep`
- [heimdall](https://github.com/Jon-Becker/heimdall-rs) — для декомпиляции bytecode (опционально)
