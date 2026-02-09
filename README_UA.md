# Розширення для ротації мульти-акаунтів Google Antigravity

TypeScript розширення для [pi-coding-agent](https://github.com/badlogic/pi-mono), яке реалізує автоматичну ротацію акаунтів для провайдера `google-antigravity` для обходу обмежень швидкості запитів.

## Можливості

### Основні функції
- **Зберігання мульти-акаунтів** - Безпечне збереження декількох Google OAuth облікових даних
- **Інтерактивне налаштування** - Конфігурація через команду `/rotationsetup`
- **Автоматична ротація** - Виявлення помилок обмеження (429, 404, перевищення квоти) та перемикання
- **Ручне керування** - Використання інструменту `rotate_account`
- **Збереження в сесії** - Стан зберігається після перезапусків та працює між гілками
- **Кастомний рендеринг** - Красиве відображення в TUI

### Функції v1.2.0 (НОВІ)
- **Логіка очікування при rate limit** - Очікування перед ротацією для збереження prompt cache
- **Поріг м'якої квоти** - Пропуск акаунтів з високим рівнем помилок
- **Експоненціальне відкладання** - Розумний розрахунок часу очікування (5с, 10с, 20с...)

### Функції v1.1.0
- **Файл конфігурації** - `~/.pi/agent/rotation-config.json` для постійних налаштувань
- **Стратегії вибору** - Вибір між `sticky`, `round-robin` або `hybrid` (за замовчуванням)
- **Увімкнення/вимкнення акаунтів** - Перемикання без видалення
- **Оцінка здоров'я** - Кожен акаунт має оцінку 0-100 на основі історії
- **Журналювання налагодження** - Увімкнення через конфіг або `PI_ROTATION_DEBUG`
- **PID зміщення** - Розподіл паралельних сесій між акаунтами

## Встановлення

### Варіант 1: Глобальне розширення

```bash
cp account-rotation.ts ~/.pi/agent/extensions/
```

### Варіант 2: Локальне для проекту

```bash
mkdir -p .pi/extensions
cp account-rotation.ts .pi/extensions/
```

### Варіант 3: Тимчасове завантаження

```bash
pi -e ./account-rotation.ts
```

## Швидкий старт

```bash
# 1. Запустіть pi з розширенням
pi -e ./account-rotation.ts

# 2. Налаштуйте акаунти
/rotationsetup

# 3. Перевірте статус
/rotationstatus

# 4. Готово! Ротація відбувається автоматично при rate limits
```

## Використання

### Команди

| Команда | Опис |
|---------|------|
| `/rotationsetup` | Інтерактивний майстер налаштування |
| `/rotationstatus` | Показати статус та оцінки здоров'я |
| `/rotationconfig` | Показати поточну конфігурацію |

### Дії інструменту

Інструмент `rotate_account` підтримує ці дії:

| Дія | Опис |
|-----|------|
| `rotate` | Переключити на наступний акаунт |
| `status` | Показати всі акаунти з деталями |
| `health` | Показати оцінки здоров'я |
| `enable <id>` | Увімкнути акаунт |
| `disable <id>` | Вимкнути акаунт |
| `reset` | Очистити лічильники помилок |

Приклад:
```typescript
rotate_account({ action: "health" })
rotate_account({ action: "disable", accountId: "acc_123..." })
```

## Конфігурація

Розширення використовує `~/.pi/agent/rotation-config.json`:

```json
{
  "account_selection_strategy": "hybrid",
  "pid_offset_enabled": false,
  "max_rate_limit_wait_seconds": 60,
  "failure_ttl_seconds": 3600,
  "rate_limit_wait_enabled": true,
  "rate_limit_initial_wait_seconds": 5,
  "soft_quota_threshold_percent": 90,
  "debug": false,
  "quiet_mode": false
}
```

### Стратегії вибору

| Стратегія | Опис | Найкраще для |
|-----------|------|--------------|
| `sticky` | Залишатись на тому ж акаунті до rate limit | Збереження prompt cache |
| `round-robin` | Ротація на кожному запиті | Максимальна пропускна здатність |
| `hybrid` | Вибір за оцінкою здоров'я | Загальне використання (за замовчуванням) |

### Опції конфігурації

| Опція | За замовчуванням | Опис |
|-------|------------------|------|
| `account_selection_strategy` | `hybrid` | Як вибирати акаунти |
| `pid_offset_enabled` | `false` | Використовувати PID для початкового вибору |
| `max_rate_limit_wait_seconds` | `60` | Максимальний час очікування |
| `rate_limit_wait_enabled` | `true` | Чекати перед ротацією (зберігає cache) |
| `rate_limit_initial_wait_seconds` | `5` | Початковий час очікування |
| `soft_quota_threshold_percent` | `90` | Пропускати акаунти з цим % помилок |
| `failure_ttl_seconds` | `3600` | Скидати помилки після цього часу |
| `debug` | `false` | Увімкнути журналювання налагодження |
| `quiet_mode` | `false` | Приховати сповіщення |

## Логіка очікування Rate Limit (v1.2.0)

При виявленні rate limit розширення тепер:

1. **Перевіряє можливість очікування** - Чекає лише якщо увімкнено кілька акаунтів
2. **Розраховує час очікування** - Експоненціальне відкладання (5с, 10с, 20с, 40с...)
3. **Чекає перед ротацією** - Зберігає prompt cache якщо очікування розумне
4. **Ротує за потреби** - Переключається на здоровіший акаунт після очікування

Це допомагає зберегти prompt cache, чекаючи коротко перед переключенням акаунтів.

## Поріг м'якої квоти (v1.2.0)

Акаунти автоматично пропускаються, якщо досягли порогу м'якої квоти:
- Зараз обмежені (rateLimitUntil не закінчився)
- Високий рівень помилок (>= soft_quota_threshold_percent)

Це запобігає повторним спробам акаунтів, які ймовірно зазнають невдачі.

## Оцінки здоров'я

Кожен акаунт має оцінку здоров'я (0-100):

- **100** - Здоровий, без проблем
- **50-99** - Деякі минулі помилки або rate limits
- **0-49** - Недавні rate limits, може бути тимчасово уникнуто
- **Активний rate limit** - Оцінка падає до ~20

Стратегія `hybrid` використовує оцінки здоров'я для вибору найкращого акаунту.

## Керування акаунтами

### Увімкнення/Вимкнення акаунтів

Через `/rotationsetup`:
1. Виконайте `/rotationsetup`
2. Виберіть "Manage existing accounts"
3. Перемкніть статус акаунту

Через інструмент:
```typescript
rotate_account({ action: "disable", accountId: "acc_123..." })
rotate_account({ action: "enable", accountId: "acc_123..." })
```

### Скидання лічильників помилок

```typescript
rotate_account({ action: "reset" })
```

## Виявлення Rate Limit

Розширення виявляє:
- HTTP 429 статус код
- "rate limit" у повідомленні помилки
- "quota exceeded" у повідомленні помилки
- "resource_exhausted" у повідомленні помилки
- "rate_limit_exceeded" у повідомленні помилки
- 404 помилки з "not found" (пов'язані з квотою)
- "too many requests" у повідомленні помилки

## Налагодження

### Увімкнення журналювання

Варіант 1 - Змінна середовища:
```bash
PI_ROTATION_DEBUG=1 pi -e ./account-rotation.ts
```

Варіант 2 - Конфігурація:
```json
{
  "debug": true
}
```

Варіант 3 - Через `/rotationsetup`:
1. Виберіть "Configure settings"
2. Перемкніть debug logging

### Вивід журналу

Журнали налагодження показують:
- Завантаження конфігурації
- Рішення вибору акаунту
- Виявлення rate limit
- Розрахунки часу очікування
- Події ротації
- Розрахунки оцінок здоров'я

## Паралельні сесії

Для паралельних агентів (стиль oh-my-opencode):

```json
{
  "pid_offset_enabled": true
}
```

Кожен процес почне з різного акаунту на основі PID.

## Файли

| Файл | Розташування |
|------|--------------|
| Розширення | `~/.pi/agent/extensions/account-rotation.ts` |
| Облікові дані | `~/.pi/agent/rotation-credentials.json` |
| Конфігурація | `~/.pi/agent/rotation-config.json` |

**Безпека**: Файл облікових даних створюється з режимом `0o600` (лише власник).

## Довідник API

### Структура стану

```typescript
interface AccountRotationState {
  accounts: AccountCredentials[];
  currentIndex: number;
  rotationCount: number;
  quotaState: Record<string, AccountQuotaState>;
}

interface AccountCredentials {
  id: string;
  refresh: string;
  access: string;
  expires: number;
  label?: string;
  addedAt: number;
  enabled: boolean;
}

interface AccountQuotaState {
  lastRateLimitAt?: number;
  rateLimitUntil?: number;
  requestCount: number;
  failureCount: number;
  lastSuccessAt?: number;
}
```

### Оброблювані події

- `session_start/switch/fork/tree` - Відновлення стану
- `model_error` - Автоматична ротація при rate limits з логікою очікування

## Вирішення проблем

### "No enabled accounts"

Всі акаунти вимкнені. Виконайте `/rotationsetup` > "Manage existing accounts" для увімкнення.

### "All accounts may be rate limited"

1. Зачекайте скидання квоти (щогодини/щодня)
2. Додайте більше акаунтів
3. Скиньте лічильники: `rotate_account({ action: "reset" })`

### Стан не зберігається

- Перевірте, що не використовуєте ефемерні сесії
- Перевірте збереження файлу сесії
- Стан зберігається в `details` результату інструменту

### Конфігурація не завантажується

- Перевірте існування файлу: `~/.pi/agent/rotation-config.json`
- Перевірте синтаксис JSON
- Перевірте права доступу

## Історія версій

### v1.2.0 (Поточна)
- Логіка очікування rate limit (очікування перед ротацією для збереження cache)
- Поріг м'якої квоти (пропуск акаунтів з високим рівнем помилок)
- Експоненціальне відкладання для часу очікування
- Нові опції: `rate_limit_wait_enabled`, `rate_limit_initial_wait_seconds`, `soft_quota_threshold_percent`

### v1.1.0
- Система файлу конфігурації
- Стратегії вибору (sticky, round-robin, hybrid)
- Увімкнення/вимкнення акаунтів
- Система оцінки здоров'я
- Журналювання налагодження
- Підтримка PID зміщення
- Команди `/rotationstatus` та `/rotationconfig`

### v1.0.0
- Початковий випуск
- Зберігання мульти-акаунтів
- Автоматична ротація при rate limits
- Ручна ротація через інструмент
- Збереження сесії

## Ліцензія

MIT

## Внесок

Дивіться [AGENTS.md](AGENTS.md) та [RESEARCH_AND_ROADMAP.md](RESEARCH_AND_ROADMAP.md) для керівництва з розробки.

## Подяки

Створено для [pi-coding-agent](https://github.com/badlogic/pi-mono) згідно з патернами API розширень.

Натхненно [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth).
