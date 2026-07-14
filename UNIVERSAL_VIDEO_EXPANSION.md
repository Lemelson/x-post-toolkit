# Universal Video Toolkit Ideas

## Цель

Сделать расширение не "под Twitter", а под общий сценарий:

- найти видео на странице,
- получить прямой media URL или fallback download URL,
- отдать видео в единый local transcription pipeline,
- сохранить историю, ссылку на источник и текст,
- легко подключать новые сайты через маленькие site adapters.

## Предлагаемая архитектура

### 1. Общий пайплайн

Общий объект контекста для любого сайта:

```js
{
  itemId: "platform:sourceId",
  platform: "x" | "gdrive" | "...",
  itemUrl: "https://...",
  title: "Video title or page snippet",
  mediaUrl: "https://...mp4 or signed stream url"
}
```

Что остаётся общим:

- очередь транскрибации,
- кэш,
- history storage,
- native host,
- popup,
- скачивание `.txt`,
- status/badge/toast,
- naming файлов.

Что становится site-specific:

- как найти видео на странице,
- куда встроить кнопки,
- как собрать `itemId`,
- как получить `mediaUrl`,
- какой canonical URL сохранять.

### 2. Site adapter interface

Полезно держать один адаптер на платформу:

```js
{
  id: "x",
  match: () => boolean,
  scan: () => void,
  getVisibleContext: () => context | null
}
```

Тогда новые платформы подключаются добавлением нового адаптера, а не переписыванием всего `content.js`.

### 3. Два режима получения видео

- `direct media`: уже есть прямой signed/media URL, можно сразу скачивать и транскрибировать.
- `resolved download`: прямого URL нет, но можно собрать download endpoint из page/file id.

Для транскрибации приоритет лучше отдавать `direct media`, потому что native host работает вне браузера и не видит browser cookies.

## Куда расширять дальше

### Tier 1: самый быстрый ROI

- Google Drive
  Уже начато. Частый кейс: личные видео, shared links, быстрая локальная транскрибация.
- Loom
  Часто есть HTML5 video и понятная страница с записью.
- Dropbox shared video links
  Обычно простой file preview/download flow.
- Google Photos shared video pages
  Пользовательский кейс близок к Drive.
- Telegram Web
  Ценный сценарий, если удастся стабильно вытащить media URL.

### Tier 2: хорошие продуктовые кандидаты

- Instagram Reels / posts
  Очень высокий value, но более агрессивный UI и anti-scraping.
- YouTube
  Не столько download, сколько transcript/clip workflow. Нужно аккуратно из-за продуктовых ограничений платформы.
- TikTok Web
  Высокий спрос, но возможна более ломкая интеграция.
- LinkedIn video posts
  B2B use case: быстро снять транскрипт с выступлений и интервью.
- Reddit hosted videos
  Реально полезно для ресерча и мониторинга.

### Tier 3: нишевые, но сильные

- VK Video / VK Clips
- Vimeo
- Wistia embeds
- Brightcove embeds
- Kajabi / Teachable lesson players
- Coursera / Udemy web players
- Notion pages with embedded video
- Slack web file/video previews

## Приоритет по сложности

### Самые лёгкие

- сайты, где есть обычный `<video>` и `currentSrc`,
- shared file pages,
- video hosting с прямыми mp4/hls ссылками.

### Средние

- SPA c нестабильным DOM,
- платформы, где надо слушать route changes,
- страницы, где кнопки нужно ставить поверх player overlay.

### Самые сложные

- сайты с blob/MSE без доступного прямого URL,
- auth-only media, которые не открыть из native host без cookies,
- платформы с жёстким anti-automation,
- DRM protected video.

## Практический roadmap

### Шаг 1

- вынести adapters в отдельный модуль,
- зафиксировать единый `item context`,
- добить X + Google Drive до стабильного состояния.

### Шаг 2

- добавить `loom`,
- добавить `dropbox`,
- добавить `reddit hosted video`.

### Шаг 3

- исследовать `instagram`,
- исследовать `telegram web`,
- исследовать `vk video`.

## Что ещё можно добавить в продукт

- выбор ASR backend в popup,
- summary поверх транскрипта,
- timestamped transcript,
- export в Markdown / JSON / SRT,
- auto-copy и auto-save toggle,
- batch mode для нескольких видео на странице,
- hotkey "transcribe current video",
- sidebar with transcript instead of only clipboard,
- detect language + translate,
- speaker labels,
- searchable local archive.

## Главная инженерная мысль

Лучше строить систему не как "Twitter downloader с исключениями", а как:

`core pipeline + thin adapters per site`.

Тогда новые источники будут добавляться быстро, а вся сложная часть останется общей и обслуживаемой.
