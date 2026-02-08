# pi-antigravity-multiaccount

> **🇬🇧 English** | **[🇺🇦 Українська](#українська)**

Automatic account rotation for `google-antigravity` provider in [pi-coding-agent](https://github.com/badlogic/pi-mono) to bypass rate limits.

## 🚀 Quick Start

```bash
# Install
cp account-rotation.ts ~/.pi/agent/extensions/

# Run pi
pi

# Setup accounts
> /rotationsetup

# Done! Auto-rotation is active
```

📖 **Full documentation**: [QUICKSTART.md](QUICKSTART.md)

## ✨ Features

- 🔄 **Auto-rotation** on rate limits (429, quota exceeded)
- ⚙️ **Interactive setup** via `/rotationsetup` command
- 💾 **Session persistence** across restarts and branches
- 🎨 **Beautiful TUI** with custom rendering
- 🛠️ **Manual control** via `rotate_account` tool
- 🌲 **Branch-aware** state management

## 📚 Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - Get started in 5 minutes
- **[README.md](README.md)** - Complete guide
- **[SETUP.md](SETUP.md)** - How to get OAuth tokens
- **[FILES.md](FILES.md)** - Project structure

## 🔐 Security

OAuth tokens are sensitive! This extension:
- ✅ Never commits tokens (`.gitignore`)
- ✅ Stores only in pi session
- ✅ No external files needed
- ✅ Security best practices documented

## 📦 Installation Options

### Global (recommended)
```bash
cp account-rotation.ts ~/.pi/agent/extensions/
```

### Project-local
```bash
mkdir -p .pi/extensions
cp account-rotation.ts .pi/extensions/
```

### NPM package
```bash
npm install pi-extension-antigravity-rotation
```

## 💡 How It Works

```
Rate Limit → Detect → Rotate → Update Provider → Continue
```

The extension listens for `model_error` events, detects rate limit errors, and automatically switches to the next configured Google account.

## 🛠️ Tech Stack

- **TypeScript** - Extension code
- **pi-coding-agent** - Extension API
- **@sinclair/typebox** - Schema validation

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please:
- Update both English and Ukrainian docs
- Follow existing code style
- Test with `pi -e ./account-rotation.ts`

---

<a name="українська"></a>

# pi-antigravity-multiaccount

> **[🇬🇧 English](#pi-antigravity-multiaccount)** | **🇺🇦 Українська**

Автоматична ротація акаунтів для провайдера `google-antigravity` в [pi-coding-agent](https://github.com/badlogic/pi-mono) для обходу обмежень швидкості.

## 🚀 Швидкий старт

```bash
# Встановлення
cp account-rotation.ts ~/.pi/agent/extensions/

# Запуск pi
pi

# Налаштування акаунтів
> /rotationsetup

# Готово! Автоматична ротація активна
```

📖 **Повна документація**: [QUICKSTART_UA.md](QUICKSTART_UA.md)

## ✨ Можливості

- 🔄 **Авто-ротація** при обмеженнях (429, quota exceeded)
- ⚙️ **Інтерактивне налаштування** через команду `/rotationsetup`
- 💾 **Збереження в сесії** між перезапусками та гілками
- 🎨 **Красивий TUI** з кастомним рендерингом
- 🛠️ **Ручне керування** через інструмент `rotate_account`
- 🌲 **Управління станом** з урахуванням гілок

## 📚 Документація

- **[QUICKSTART_UA.md](QUICKSTART_UA.md)** - Початок за 5 хвилин
- **[README_UA.md](README_UA.md)** - Повний гід
- **[SETUP_UA.md](SETUP_UA.md)** - Як отримати OAuth токени
- **[FILES_UA.md](FILES_UA.md)** - Структура проекту
- **[SUMMARY_UA.md](SUMMARY_UA.md)** - Короткий огляд

## 🔐 Безпека

OAuth токени конфіденційні! Це розширення:
- ✅ Ніколи не комітить токени (`.gitignore`)
- ✅ Зберігає лише в pi сесії
- ✅ Не потребує зовнішніх файлів
- ✅ Документовані найкращі практики безпеки

## 📦 Варіанти встановлення

### Глобальне (рекомендовано)
```bash
cp account-rotation.ts ~/.pi/agent/extensions/
```

### Локальне для проекту
```bash
mkdir -p .pi/extensions
cp account-rotation.ts .pi/extensions/
```

### NPM пакет
```bash
npm install pi-extension-antigravity-rotation
```

## 💡 Як це працює

```
Обмеження → Виявлення → Ротація → Оновлення провайдера → Продовження
```

Розширення прослуховує події `model_error`, виявляє помилки обмеження швидкості та автоматично перемикається на наступний налаштований акаунт Google.

## 🛠️ Технології

- **TypeScript** - Код розширення
- **pi-coding-agent** - Extension API
- **@sinclair/typebox** - Валідація схем

## 📝 Ліцензія

MIT

## 🤝 Внесок

Внески вітаються! Будь ласка:
- Оновлюйте документацію обома мовами
- Слідуйте існуючому стилю коду
- Тестуйте з `pi -e ./account-rotation.ts`

---

## 🌟 Star History

If you find this extension useful, please consider giving it a star! ⭐

## 📞 Support

- 🐛 **Bug reports**: Create an issue
- 💡 **Feature requests**: Create an issue
- 📖 **Documentation**: See docs above
- 💬 **Questions**: Create a discussion

---

**Made with ❤️ for [pi-coding-agent](https://github.com/badlogic/pi-mono)** | **2024**
