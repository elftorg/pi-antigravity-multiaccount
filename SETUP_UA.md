# Приклад конфігурації акаунтів

Цей файл показує приклади форматування Google OAuth облікових даних для розширення ротації.

## Формат 1: Повний OAuth об'єкт (Рекомендовано)

```json
{
  "refresh": "1//0gXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "access": "ya29.a0AfB_byXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "expires": 1707436800000
}
```

**Поля:**
- `refresh`: Refresh токен (починається з `1//0g`)
- `access`: Access токен (починається з `ya29.`)
- `expires`: Unix timestamp у мілісекундах, коли закінчується термін дії токена доступу

## Формат 2: Лише токен доступу

Якщо у вас є лише токен доступу, вставте його безпосередньо:

```
ya29.a0AfB_byXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Розширення використає його як для refresh, так і для access, з типовим терміном дії 1 година.

## Формат 3: JSON рядковий токен

```json
"ya29.a0AfB_byXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

Те ж саме, що Формат 2, але обгорнуто в JSON лапки.

## Як отримати Google OAuth токени

### Метод 1: Використання Google Cloud Console

1. Перейдіть до [Google Cloud Console](https://console.cloud.google.com/)
2. Створіть новий проект або виберіть існуючий
3. Увімкніть необхідні API (наприклад, Gemini API)
4. Перейдіть до "APIs & Services" → "Credentials"
5. Створіть OAuth 2.0 Client ID
6. Завантажте JSON облікових даних
7. Використовуйте OAuth 2.0 Playground або gcloud CLI для отримання токенів

### Метод 2: Використання OAuth 2.0 Playground

1. Перейдіть до [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. Натисніть іконку шестерні (⚙️) у верхньому правому куті
3. Поставте галочку "Use your own OAuth credentials"
4. Введіть ваш Client ID та Client Secret
5. У Кроці 1 виберіть API, які вам потрібні (наприклад, "Google Gemini API v1")
6. Натисніть "Authorize APIs"
7. У Кроці 2 натисніть "Exchange authorization code for tokens"
8. Скопіюйте `access_token` та `refresh_token`

### Метод 3: Використання gcloud CLI

```bash
# Встановіть gcloud, якщо ще не встановлено
# https://cloud.google.com/sdk/docs/install

# Увійдіть і отримайте облікові дані
gcloud auth login

# Отримайте токен доступу
gcloud auth print-access-token

# Отримайте повні OAuth облікові дані
gcloud auth application-default print-access-token --format=json
```

### Метод 4: Використання google-auth-library (Node.js)

```javascript
const { OAuth2Client } = require('google-auth-library');

const oauth2Client = new OAuth2Client(
  'YOUR_CLIENT_ID',
  'YOUR_CLIENT_SECRET',
  'YOUR_REDIRECT_URI'
);

// Згенеруйте URL авторизації
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/generative-language']
});

console.log('Відвідайте цей URL:', authUrl);

// Після авторизації користувача обміняйте код на токени
const { tokens } = await oauth2Client.getToken('AUTHORIZATION_CODE');
console.log(JSON.stringify(tokens, null, 2));
```

## Приклад: Налаштування декількох акаунтів

При використанні `/rotationsetup` вам буде запропоновано кілька разів. Ось приклад сесії:

```
Додати акаунт (1):
> {"refresh":"1//0gAAA...", "access":"ya29.a0AAA...", "expires":1707436800000}
✓ Акаунт 1 успішно додано!

Додати ще один? Так

Додати акаунт (2):
> ya29.a0BBB...
✓ Акаунт 2 успішно додано!

Додати ще один? Так

Додати акаунт (3):
> {"refresh":"1//0gCCC...", "access":"ya29.a0CCC...", "expires":1707440400000}
✓ Акаунт 3 успішно додано!

Додати ще один? Ні

✓ Налаштування завершено! 3 акаунт(и) налаштовано. Зараз використовується акаунт 1.
```

## Примітки щодо безпеки

⚠️ **ВАЖЛИВО**: OAuth токени - це конфіденційні облікові дані, які надають доступ до вашого облікового запису Google!

- **Ніколи не комітьте токени до системи контролю версій** (додайте до `.gitignore`)
- **Не діліться токенами публічно**
- **Регулярно ротуйте токени** для безпеки
- **Використовуйте сервісні акаунти** для виробничих систем, коли це можливо
- **Обмежуйте області доступу токенів** лише до необхідного
- **Зберігайте токени безпечно** (змінні оточення, менеджери секретів)
- **Відкликайте токени** коли вони більше не потрібні

## Закінчення терміну дії токенів

- **Access токени** зазвичай закінчуються через 1 годину
- **Refresh токени** можуть мати тривалий термін дії або закінчуватися залежно від політики
- Розширення зберігає обидва, але покладається на механізм оновлення провайдера
- Якщо токени закінчуються під час ротації, вам може знадобитися перезапустити `/rotationsetup`

## Вирішення проблем

### "Invalid credentials format" (Невірний формат облікових даних)

Переконайтеся, що ваш JSON дійсний:
- Використовуйте подвійні лапки для ключів та рядкових значень
- Без коми в кінці
- Правильне екранування спеціальних символів

### "Failed to rotate account" (Не вдалося виконати ротацію акаунту)

- Перевірте, що токени все ще дійсні (не застарілі або не відкликані)
- Переконайтеся, що провайдер google-antigravity доступний
- Переконайтеся, що у вас є належний доступ до API

### Обмеження швидкості все ще виникають

- Деякі API мають обмеження на проект, а не лише на акаунт
- Розгляньте використання різних проектів Google Cloud для кожного акаунту
- Додайте більше акаунтів для розподілу навантаження
- Реалізуйте обмеження запитів у вашому додатку

## Найкращі практики

1. **Використовуйте принаймні 3-5 акаунтів** для надійної ротації
2. **Тестуйте кожен акаунт** перед додаванням, щоб переконатися, що він працює
3. **Відстежуйте кількість ротацій** щоб виявити проблемний акаунт
4. **Налаштуйте моніторинг** для подій обмеження швидкості
5. **Майте резервний план** якщо всі акаунти вичерпано
6. **Документуйте налаштування** для членів команди

## Розширене: Сервісні акаунти

Для виробничого використання розгляньте Google Service Accounts:

```bash
# Створіть сервісний акаунт
gcloud iam service-accounts create rotation-account-1

# Згенеруйте ключ
gcloud iam service-accounts keys create key1.json \
  --iam-account=rotation-account-1@PROJECT_ID.iam.gserviceaccount.com

# Надайте необхідні дозволи
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:rotation-account-1@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

Потім використовуйте ключ сервісного акаунту для генерації OAuth токенів.
