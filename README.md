                                                                                                                                        
  Структура проекта                                                                                                                       
                                                                                                                                          
  agent/                                                                                                                                  
  ├── Cargo.toml                                                                                                                          
  ├── .env.example                                                                                                                        
  ├── .gitignore                                                                                                                          
  └── src/                                                                                                                                
      ├── main.rs         # Точка входа, HTTP сервер                                                                                      
      ├── config.rs       # Конфигурация из env                                                                                           
      ├── models.rs       # Модели данных (запросы/ответы)                                                                                
      ├── openrouter.rs   # Клиент OpenRouter API                                                                                         
      ├── handlers.rs     # HTTP обработчики                                                                                              
      └── error.rs        # Обработка ошибок                                                                                              
                                                                                                                                          
  API Endpoints                                                                                                                           
  ┌───────┬─────────────────────────────┬──────────────────────────────────────┐                                                          
  │ Метод │            Путь             │               Описание               │                                                          
  ├───────┼─────────────────────────────┼──────────────────────────────────────┤                                                          
  │ GET   │ /health                     │ Health check                         │                                                          
  ├───────┼─────────────────────────────┼──────────────────────────────────────┤                                                          
  │ POST  │ /v1/chat/completions        │ Chat completion (OpenAI-совместимый) │                                                          
  ├───────┼─────────────────────────────┼──────────────────────────────────────┤                                                          
  │ POST  │ /v1/chat/completions/stream │ Streaming chat (SSE)                 │                                                          
  ├───────┼─────────────────────────────┼──────────────────────────────────────┤                                                          
  │ POST  │ /v1/agent/chat              │ Упрощённый agent-интерфейс           │                                                          
  ├───────┼─────────────────────────────┼──────────────────────────────────────┤                                                          
  │ GET   │ /v1/models                  │ Список моделей OpenRouter            │                                                          
  └───────┴─────────────────────────────┴──────────────────────────────────────┘                                                          
  Запуск                                                                                                                                  
                                                                                                                                          
  1. Скопируй .env.example в .env и добавь API ключ:                                                                                      
  cp .env.example .env                                                                                                                    
  # Отредактируй .env и добавь OPENROUTER_API_KEY                                                                                         
                                                                                                                                          
  2. Запусти сервер:                                                                                                                      
  cargo run                                                                                                                               
                                                                                                                                          
  Пример запроса                                                                                                                          
                                                                                                                                          
  # Вариант 1: Всё в одной строке (рекомендуется)
  curl -X POST http://localhost:3000/v1/agent/chat -H "Content-Type: application/json" -d '{"message": "Hello, who are you?", "model": "openai/gpt-4o-mini"}'
  
  # Вариант 2: Многострочный (обратный слэш должен быть последним символом в строке!)
  curl -X POST http://localhost:3000/v1/agent/chat \
    -H "Content-Type: application/json" \
    -d '{
      "message": "Hello, who are you?",
      "model": "anthropic/claude-3.5-sonnet"
    }'
  