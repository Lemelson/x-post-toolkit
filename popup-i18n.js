"use strict";

export const LANGUAGES = [
  { code: "en", flag: "🇺🇸", name: "English" },
  { code: "ru", flag: "🇷🇺", name: "Русский" },
  { code: "es", flag: "🇪🇸", name: "Español" },
  { code: "zh", flag: "🇨🇳", name: "中文" },
  { code: "ja", flag: "🇯🇵", name: "日本語" },
  { code: "ko", flag: "🇰🇷", name: "한국어" },
  { code: "it", flag: "🇮🇹", name: "Italiano" },
  { code: "pt", flag: "🇵🇹", name: "Português" }
];

const en = {
  brandTagline: "Download · Transcribe",
  toggleTheme: "Toggle theme",
  tabHome: "Home",
  tabSettings: "Settings",
  tabAbout: "About",
  checkingPage: "Checking this page",
  detectingVideo: "Looking for a supported video…",
  currentVideo: "{platform} video · {id}",
  sourceX: "Current X video",
  sourceDrive: "Current Drive video",
  noSupportedVideo: "Open a video on X or Google Drive",
  platformX: "X",
  platformDrive: "Drive",
  transcribeVideo: "Transcribe video",
  copyExisting: "Copy transcript",
  transcribeHint: "Local Parakeet · copied automatically",
  downloadVideo: "Download video",
  downloadHint: "Best available quality",
  saveCurrentTranscript: "Save current transcript as .txt",
  libraryEyebrow: "Your library",
  recentTranscripts: "Recent transcripts",
  clearHistory: "Clear",
  clearConfirm: "Click again",
  preferencesEyebrow: "Preferences",
  settingsTitle: "Make every transcript yours",
  settingsIntro: "These defaults apply to copied text, TXT files, and your local history.",
  outputTitle: "Transcript output",
  outputSubtitle: "Choose what gets copied and saved.",
  includeTitle: "Include video title",
  includeTitleHint: "Put the post or file title above the transcript.",
  timestamps: "Timestamps",
  timestampsOff: "No timestamps",
  timestamps10: "Every ~10 seconds",
  timestamps30: "Every ~30 seconds · useful for AI",
  timestamps60: "Every ~60 seconds",
  timestampsAll: "Every sentence",
  timestampsHint: "You can still download SRT subtitles from any transcript that has timing data.",
  historySettings: "History",
  historySubtitle: "Stored only in this browser.",
  maxItems: "Maximum items",
  retention: "Keep for",
  retentionUnit: "Retention unit",
  days: "days",
  hours: "hours",
  localPrivacyTitle: "Local by design.",
  localPrivacyBody: "Transcription runs through your native host; history stays in Chrome storage.",
  saveSettings: "Save settings",
  aboutIntro: "Save the source video or turn its speech into clean, searchable text — without sending media to a cloud transcription service.",
  contactEyebrow: "Questions or found a bug?",
  contactTitle: "Talk to the person who built it",
  contactBody: "Bug reports, ideas, improvements, or collaboration — message me on Telegram. I read every message and reply there personally.",
  telegramTitle: "Message on Telegram",
  telegramHint: "Fastest reply · I answer personally",
  emailHint: "I do not always check email",
  copyEmail: "Copy email",
  openEmail: "Open email",
  howItWorks: "How Video Toolkit works",
  detailDownloadTitle: "Downloads the real media file",
  detailDownloadBody: "On X and Google Drive, the extension resolves the best available video source and hands it to Chrome Downloads.",
  detailTranscriptTitle: "Transcribes on your Mac",
  detailTranscriptBody: "The native host runs NVIDIA Parakeet locally, verifies the result, then returns clean text to the extension.",
  detailHistoryTitle: "Keeps a small local library",
  detailHistoryBody: "Recent transcripts stay in browser storage for the retention period you choose. Clear them at any time.",
  viewSource: "View source on GitHub",
  footerLocal: "Local & private",
  footerUpdated: "Updated Jul 14, 2026",
  historyEmptyTitle: "No transcripts yet",
  historyEmptyBody: "Open a supported video and transcribe it. Your recent results will appear here.",
  copyTranscript: "Copy transcript",
  copyTimestamps: "Copy with timestamps",
  downloadTxt: "Download TXT",
  downloadSrt: "Download SRT",
  openSource: "Open source",
  copyLink: "Copy source link",
  transcribing: "Transcribing {id}… This can take a few minutes.",
  downloadingVideo: "Starting the video download for {id}…",
  cachedCopied: "Saved transcript copied. It remains available for {duration}.",
  transcriptCopied: "Transcript verified, saved, and copied.",
  videoDownloadStarted: "Video download started.",
  transcriptDownloadStarted: "Transcript download started.",
  settingsSaved: "Settings saved.",
  historyCleared: "History cleared.",
  copiedItem: "Transcript copied for {id}.",
  copiedTimedItem: "Timestamped transcript copied for {id}.",
  downloadingItem: "Downloading transcript for {id}.",
  downloadingSrt: "Downloading subtitles for {id}.",
  openedSource: "Source page opened.",
  linkCopied: "Source link copied.",
  emailCopied: "Email address copied."
};

const ru = {
  brandTagline: "Скачать · Расшифровать", toggleTheme: "Сменить тему", tabHome: "Главная", tabSettings: "Настройки", tabAbout: "О расширении",
  checkingPage: "Проверяю страницу", detectingVideo: "Ищу поддерживаемое видео…", currentVideo: "Видео {platform} · {id}", sourceX: "Текущее видео в X", sourceDrive: "Текущее видео в Drive", noSupportedVideo: "Откройте видео в X или Google Drive", platformX: "X", platformDrive: "Drive",
  transcribeVideo: "Расшифровать видео", copyExisting: "Скопировать текст", transcribeHint: "Локальный Parakeet · копирование автоматически", downloadVideo: "Скачать видео", downloadHint: "Лучшее доступное качество", saveCurrentTranscript: "Сохранить текущую расшифровку в .txt",
  libraryEyebrow: "Ваша библиотека", recentTranscripts: "Недавние расшифровки", clearHistory: "Очистить", clearConfirm: "Нажмите ещё раз",
  preferencesEyebrow: "Параметры", settingsTitle: "Настройте расшифровки под себя", settingsIntro: "Эти параметры применяются к копированию, TXT-файлам и локальной истории.",
  outputTitle: "Формат расшифровки", outputSubtitle: "Выберите, что копировать и сохранять.", includeTitle: "Добавлять название видео", includeTitleHint: "Название поста или файла будет над расшифровкой.", timestamps: "Таймкоды", timestampsOff: "Без таймкодов", timestamps10: "Примерно каждые 10 секунд", timestamps30: "Примерно каждые 30 секунд · удобно для ИИ", timestamps60: "Примерно каждую минуту", timestampsAll: "Для каждого предложения", timestampsHint: "SRT-субтитры можно скачать отдельно, если в расшифровке есть временные данные.",
  historySettings: "История", historySubtitle: "Хранится только в этом браузере.", maxItems: "Максимум записей", retention: "Хранить", retentionUnit: "Единица хранения", days: "дней", hours: "часов",
  localPrivacyTitle: "Изначально локально.", localPrivacyBody: "Расшифровка выполняется через native host, а история хранится в Chrome.", saveSettings: "Сохранить настройки",
  aboutIntro: "Скачивайте исходное видео или превращайте речь в чистый текст с поиском — без отправки медиа в облачный сервис расшифровки.", contactEyebrow: "Есть вопрос или нашли баг?", contactTitle: "Напишите человеку, который это сделал", contactBody: "Баги, идеи, улучшения или сотрудничество — пишите мне в Telegram. Я читаю каждое сообщение и отвечаю лично.", telegramTitle: "Написать в Telegram", telegramHint: "Самый быстрый ответ · отвечаю лично", emailHint: "Почту проверяю не всегда", copyEmail: "Скопировать почту", openEmail: "Открыть почту",
  howItWorks: "Как работает Video Toolkit", detailDownloadTitle: "Скачивает настоящий медиафайл", detailDownloadBody: "На X и Google Drive расширение находит лучший доступный источник видео и передаёт его в загрузки Chrome.", detailTranscriptTitle: "Расшифровывает на вашем Mac", detailTranscriptBody: "Native host локально запускает NVIDIA Parakeet, проверяет результат и возвращает чистый текст в расширение.", detailHistoryTitle: "Хранит небольшую локальную библиотеку", detailHistoryBody: "Недавние расшифровки остаются в браузере на выбранный срок. Их можно очистить в любой момент.", viewSource: "Исходный код на GitHub", footerLocal: "Локально и приватно", footerUpdated: "Обновлено 14 июля 2026",
  historyEmptyTitle: "Расшифровок пока нет", historyEmptyBody: "Откройте поддерживаемое видео и расшифруйте его. Недавние результаты появятся здесь.", copyTranscript: "Скопировать расшифровку", copyTimestamps: "Скопировать с таймкодами", downloadTxt: "Скачать TXT", downloadSrt: "Скачать SRT", openSource: "Открыть источник", copyLink: "Скопировать ссылку",
  transcribing: "Расшифровываю {id}… Это может занять несколько минут.", downloadingVideo: "Запускаю скачивание видео {id}…", cachedCopied: "Сохранённая расшифровка скопирована. Она будет доступна ещё {duration}.", transcriptCopied: "Расшифровка проверена, сохранена и скопирована.", videoDownloadStarted: "Скачивание видео началось.", transcriptDownloadStarted: "Скачивание расшифровки началось.", settingsSaved: "Настройки сохранены.", historyCleared: "История очищена.", copiedItem: "Расшифровка {id} скопирована.", copiedTimedItem: "Расшифровка {id} с таймкодами скопирована.", downloadingItem: "Скачиваю расшифровку {id}.", downloadingSrt: "Скачиваю субтитры {id}.", openedSource: "Страница источника открыта.", linkCopied: "Ссылка на источник скопирована.", emailCopied: "Адрес почты скопирован."
};

const es = {
  brandTagline: "Descargar · Transcribir", toggleTheme: "Cambiar tema", tabHome: "Inicio", tabSettings: "Ajustes", tabAbout: "Información", checkingPage: "Comprobando la página", detectingVideo: "Buscando un vídeo compatible…", currentVideo: "Vídeo de {platform} · {id}", sourceX: "Vídeo actual de X", sourceDrive: "Vídeo actual de Drive", noSupportedVideo: "Abre un vídeo en X o Google Drive", platformX: "X", platformDrive: "Drive",
  transcribeVideo: "Transcribir vídeo", copyExisting: "Copiar transcripción", transcribeHint: "Parakeet local · copia automática", downloadVideo: "Descargar vídeo", downloadHint: "Mejor calidad disponible", saveCurrentTranscript: "Guardar la transcripción actual como .txt", libraryEyebrow: "Tu biblioteca", recentTranscripts: "Transcripciones recientes", clearHistory: "Borrar", clearConfirm: "Pulsa otra vez",
  preferencesEyebrow: "Preferencias", settingsTitle: "Adapta cada transcripción", settingsIntro: "Estos valores se aplican al texto copiado, los archivos TXT y el historial local.", outputTitle: "Salida de transcripción", outputSubtitle: "Elige qué se copia y se guarda.", includeTitle: "Incluir título del vídeo", includeTitleHint: "Coloca el título de la publicación o archivo sobre la transcripción.", timestamps: "Marcas de tiempo", timestampsOff: "Sin marcas de tiempo", timestamps10: "Cada ~10 segundos", timestamps30: "Cada ~30 segundos · útil para IA", timestamps60: "Cada ~60 segundos", timestampsAll: "Cada frase", timestampsHint: "Puedes descargar subtítulos SRT si la transcripción contiene datos de tiempo.", historySettings: "Historial", historySubtitle: "Guardado solo en este navegador.", maxItems: "Máximo de elementos", retention: "Conservar", retentionUnit: "Unidad de conservación", days: "días", hours: "horas", localPrivacyTitle: "Local por diseño.", localPrivacyBody: "La transcripción usa tu host nativo y el historial permanece en Chrome.", saveSettings: "Guardar ajustes",
  aboutIntro: "Guarda el vídeo original o convierte su voz en texto limpio y consultable, sin enviar el contenido a un servicio de transcripción en la nube.", contactEyebrow: "¿Dudas o encontraste un error?", contactTitle: "Habla con quien lo creó", contactBody: "Errores, ideas, mejoras o colaboración: escríbeme en Telegram. Leo todos los mensajes y respondo personalmente.", telegramTitle: "Escribir en Telegram", telegramHint: "Respuesta más rápida · respondo personalmente", emailHint: "No siempre reviso el correo", copyEmail: "Copiar correo", openEmail: "Abrir correo", howItWorks: "Cómo funciona Video Toolkit", detailDownloadTitle: "Descarga el archivo multimedia real", detailDownloadBody: "En X y Google Drive, la extensión resuelve la mejor fuente disponible y la entrega a Descargas de Chrome.", detailTranscriptTitle: "Transcribe en tu Mac", detailTranscriptBody: "El host nativo ejecuta NVIDIA Parakeet localmente, verifica el resultado y devuelve texto limpio.", detailHistoryTitle: "Mantiene una pequeña biblioteca local", detailHistoryBody: "Las transcripciones recientes permanecen en el navegador durante el periodo elegido. Puedes borrarlas cuando quieras.", viewSource: "Ver código en GitHub", footerLocal: "Local y privado", footerUpdated: "Actualizado el 14 jul 2026",
  historyEmptyTitle: "Aún no hay transcripciones", historyEmptyBody: "Abre un vídeo compatible y transcríbelo. Tus resultados recientes aparecerán aquí.", copyTranscript: "Copiar transcripción", copyTimestamps: "Copiar con marcas", downloadTxt: "Descargar TXT", downloadSrt: "Descargar SRT", openSource: "Abrir fuente", copyLink: "Copiar enlace", transcribing: "Transcribiendo {id}… Puede tardar unos minutos.", downloadingVideo: "Iniciando la descarga de {id}…", cachedCopied: "Transcripción guardada copiada. Seguirá disponible durante {duration}.", transcriptCopied: "Transcripción verificada, guardada y copiada.", videoDownloadStarted: "Descarga de vídeo iniciada.", transcriptDownloadStarted: "Descarga de transcripción iniciada.", settingsSaved: "Ajustes guardados.", historyCleared: "Historial borrado.", copiedItem: "Transcripción copiada para {id}.", copiedTimedItem: "Transcripción con marcas copiada para {id}.", downloadingItem: "Descargando transcripción para {id}.", downloadingSrt: "Descargando subtítulos para {id}.", openedSource: "Página de origen abierta.", linkCopied: "Enlace de origen copiado.", emailCopied: "Correo copiado."
};

const zh = {
  brandTagline: "下载 · 转录", toggleTheme: "切换主题", tabHome: "主页", tabSettings: "设置", tabAbout: "关于", checkingPage: "正在检查页面", detectingVideo: "正在查找支持的视频…", currentVideo: "{platform} 视频 · {id}", sourceX: "当前 X 视频", sourceDrive: "当前 Drive 视频", noSupportedVideo: "请在 X 或 Google Drive 中打开视频", platformX: "X", platformDrive: "Drive", transcribeVideo: "转录视频", copyExisting: "复制转录", transcribeHint: "本地 Parakeet · 自动复制", downloadVideo: "下载视频", downloadHint: "最佳可用画质", saveCurrentTranscript: "将当前转录保存为 .txt", libraryEyebrow: "你的资料库", recentTranscripts: "最近的转录", clearHistory: "清除", clearConfirm: "再次点击",
  preferencesEyebrow: "偏好设置", settingsTitle: "按你的方式生成转录", settingsIntro: "这些默认设置会应用于复制的文本、TXT 文件和本地历史。", outputTitle: "转录输出", outputSubtitle: "选择复制和保存的内容。", includeTitle: "包含视频标题", includeTitleHint: "在转录上方加入帖子或文件标题。", timestamps: "时间戳", timestampsOff: "无时间戳", timestamps10: "约每 10 秒", timestamps30: "约每 30 秒 · 适合 AI", timestamps60: "约每 60 秒", timestampsAll: "每个句子", timestampsHint: "只要转录包含时间数据，仍可下载 SRT 字幕。", historySettings: "历史", historySubtitle: "仅保存在此浏览器中。", maxItems: "最多条目", retention: "保留时间", retentionUnit: "保留单位", days: "天", hours: "小时", localPrivacyTitle: "本地优先。", localPrivacyBody: "转录通过本机主机运行，历史保留在 Chrome 存储中。", saveSettings: "保存设置",
  aboutIntro: "保存原始视频，或将语音转换为清晰、可搜索的文字，无需把媒体发送到云端转录服务。", contactEyebrow: "有问题或发现错误？", contactTitle: "直接联系开发者", contactBody: "错误报告、想法、改进或合作，请在 Telegram 联系我。我会阅读并亲自回复每条消息。", telegramTitle: "在 Telegram 联系", telegramHint: "回复最快 · 我会亲自回复", emailHint: "我不一定经常查看邮箱", copyEmail: "复制邮箱", openEmail: "打开邮箱", howItWorks: "Video Toolkit 的工作方式", detailDownloadTitle: "下载真实媒体文件", detailDownloadBody: "在 X 和 Google Drive 上，扩展会找到最佳可用视频源并交给 Chrome 下载。", detailTranscriptTitle: "在 Mac 上本地转录", detailTranscriptBody: "本机主机在本地运行 NVIDIA Parakeet，验证结果后把干净文本返回扩展。", detailHistoryTitle: "保留一个小型本地资料库", detailHistoryBody: "最近的转录会按你选择的期限保存在浏览器中，可随时清除。", viewSource: "在 GitHub 查看源码", footerLocal: "本地且私密", footerUpdated: "更新于 2026年7月14日",
  historyEmptyTitle: "还没有转录", historyEmptyBody: "打开支持的视频并进行转录，最近结果会显示在这里。", copyTranscript: "复制转录", copyTimestamps: "复制含时间戳版本", downloadTxt: "下载 TXT", downloadSrt: "下载 SRT", openSource: "打开来源", copyLink: "复制来源链接", transcribing: "正在转录 {id}… 可能需要几分钟。", downloadingVideo: "正在开始下载 {id}…", cachedCopied: "已复制保存的转录，还可使用 {duration}。", transcriptCopied: "转录已验证、保存并复制。", videoDownloadStarted: "视频下载已开始。", transcriptDownloadStarted: "转录下载已开始。", settingsSaved: "设置已保存。", historyCleared: "历史已清除。", copiedItem: "已复制 {id} 的转录。", copiedTimedItem: "已复制 {id} 的含时间戳转录。", downloadingItem: "正在下载 {id} 的转录。", downloadingSrt: "正在下载 {id} 的字幕。", openedSource: "已打开来源页面。", linkCopied: "来源链接已复制。", emailCopied: "邮箱地址已复制。"
};

const ja = {
  brandTagline: "ダウンロード · 文字起こし", toggleTheme: "テーマを切り替える", tabHome: "ホーム", tabSettings: "設定", tabAbout: "情報", checkingPage: "ページを確認中", detectingVideo: "対応動画を探しています…", currentVideo: "{platform} 動画 · {id}", sourceX: "現在の X 動画", sourceDrive: "現在の Drive 動画", noSupportedVideo: "X または Google Drive で動画を開いてください", platformX: "X", platformDrive: "Drive", transcribeVideo: "動画を文字起こし", copyExisting: "文字起こしをコピー", transcribeHint: "ローカル Parakeet · 自動コピー", downloadVideo: "動画をダウンロード", downloadHint: "利用可能な最高画質", saveCurrentTranscript: "現在の文字起こしを .txt で保存", libraryEyebrow: "ライブラリ", recentTranscripts: "最近の文字起こし", clearHistory: "消去", clearConfirm: "もう一度押す",
  preferencesEyebrow: "環境設定", settingsTitle: "文字起こしを自分好みに", settingsIntro: "コピーしたテキスト、TXT ファイル、ローカル履歴に適用されます。", outputTitle: "文字起こしの出力", outputSubtitle: "コピー・保存する内容を選びます。", includeTitle: "動画タイトルを含める", includeTitleHint: "投稿またはファイル名を文字起こしの上に追加します。", timestamps: "タイムスタンプ", timestampsOff: "タイムスタンプなし", timestamps10: "約10秒ごと", timestamps30: "約30秒ごと · AI 向け", timestamps60: "約60秒ごと", timestampsAll: "すべての文", timestampsHint: "時刻データがあれば SRT 字幕もダウンロードできます。", historySettings: "履歴", historySubtitle: "このブラウザ内だけに保存されます。", maxItems: "最大件数", retention: "保存期間", retentionUnit: "保存単位", days: "日", hours: "時間", localPrivacyTitle: "ローカル設計。", localPrivacyBody: "文字起こしはネイティブホストで実行され、履歴は Chrome に残ります。", saveSettings: "設定を保存",
  aboutIntro: "メディアをクラウド文字起こしサービスへ送らず、元動画の保存や音声の検索可能なテキスト化ができます。", contactEyebrow: "質問やバグ報告はこちら", contactTitle: "開発者に直接相談", contactBody: "バグ、アイデア、改善、コラボは Telegram でご連絡ください。すべて読み、本人が返信します。", telegramTitle: "Telegram で連絡", telegramHint: "最速の返信 · 本人が対応", emailHint: "メールは常に確認していません", copyEmail: "メールをコピー", openEmail: "メールを開く", howItWorks: "Video Toolkit の仕組み", detailDownloadTitle: "実際のメディアファイルを取得", detailDownloadBody: "X と Google Drive で最適な動画ソースを解決し、Chrome のダウンロードへ渡します。", detailTranscriptTitle: "Mac 上で文字起こし", detailTranscriptBody: "ネイティブホストが NVIDIA Parakeet をローカル実行し、検証したテキストを拡張機能へ返します。", detailHistoryTitle: "小さなローカルライブラリ", detailHistoryBody: "最近の文字起こしは指定期間だけブラウザに保存され、いつでも消去できます。", viewSource: "GitHub でソースを見る", footerLocal: "ローカル・プライベート", footerUpdated: "2026年7月14日更新",
  historyEmptyTitle: "文字起こしはまだありません", historyEmptyBody: "対応動画を開いて文字起こしすると、最近の結果がここに表示されます。", copyTranscript: "文字起こしをコピー", copyTimestamps: "タイムスタンプ付きでコピー", downloadTxt: "TXT をダウンロード", downloadSrt: "SRT をダウンロード", openSource: "元ページを開く", copyLink: "リンクをコピー", transcribing: "{id} を文字起こし中… 数分かかる場合があります。", downloadingVideo: "{id} のダウンロードを開始しています…", cachedCopied: "保存済み文字起こしをコピーしました。あと {duration} 利用できます。", transcriptCopied: "文字起こしを検証・保存・コピーしました。", videoDownloadStarted: "動画のダウンロードを開始しました。", transcriptDownloadStarted: "文字起こしのダウンロードを開始しました。", settingsSaved: "設定を保存しました。", historyCleared: "履歴を消去しました。", copiedItem: "{id} の文字起こしをコピーしました。", copiedTimedItem: "{id} のタイムスタンプ付き文字起こしをコピーしました。", downloadingItem: "{id} の文字起こしをダウンロード中です。", downloadingSrt: "{id} の字幕をダウンロード中です。", openedSource: "元ページを開きました。", linkCopied: "元リンクをコピーしました。", emailCopied: "メールアドレスをコピーしました。"
};

const ko = {
  brandTagline: "다운로드 · 받아쓰기", toggleTheme: "테마 전환", tabHome: "홈", tabSettings: "설정", tabAbout: "정보", checkingPage: "페이지 확인 중", detectingVideo: "지원되는 동영상을 찾는 중…", currentVideo: "{platform} 동영상 · {id}", sourceX: "현재 X 동영상", sourceDrive: "현재 Drive 동영상", noSupportedVideo: "X 또는 Google Drive에서 동영상을 여세요", platformX: "X", platformDrive: "Drive", transcribeVideo: "동영상 받아쓰기", copyExisting: "받아쓰기 복사", transcribeHint: "로컬 Parakeet · 자동 복사", downloadVideo: "동영상 다운로드", downloadHint: "사용 가능한 최고 화질", saveCurrentTranscript: "현재 받아쓰기를 .txt로 저장", libraryEyebrow: "내 라이브러리", recentTranscripts: "최근 받아쓰기", clearHistory: "지우기", clearConfirm: "한 번 더 클릭",
  preferencesEyebrow: "환경설정", settingsTitle: "원하는 방식으로 받아쓰기", settingsIntro: "복사한 텍스트, TXT 파일, 로컬 기록에 적용됩니다.", outputTitle: "받아쓰기 출력", outputSubtitle: "복사하고 저장할 내용을 선택하세요.", includeTitle: "동영상 제목 포함", includeTitleHint: "게시물 또는 파일 제목을 받아쓰기 위에 넣습니다.", timestamps: "타임스탬프", timestampsOff: "타임스탬프 없음", timestamps10: "약 10초마다", timestamps30: "약 30초마다 · AI에 유용", timestamps60: "약 60초마다", timestampsAll: "모든 문장", timestampsHint: "시간 데이터가 있는 받아쓰기는 SRT 자막도 다운로드할 수 있습니다.", historySettings: "기록", historySubtitle: "이 브라우저에만 저장됩니다.", maxItems: "최대 항목 수", retention: "보관 기간", retentionUnit: "보관 단위", days: "일", hours: "시간", localPrivacyTitle: "로컬 우선 설계.", localPrivacyBody: "받아쓰기는 네이티브 호스트에서 실행되고 기록은 Chrome에 남습니다.", saveSettings: "설정 저장",
  aboutIntro: "미디어를 클라우드 받아쓰기 서비스로 보내지 않고 원본 동영상을 저장하거나 음성을 검색 가능한 텍스트로 바꾸세요.", contactEyebrow: "질문이나 버그가 있나요?", contactTitle: "개발자에게 직접 문의", contactBody: "버그, 아이디어, 개선 또는 협업은 Telegram으로 연락해 주세요. 모든 메시지를 직접 읽고 답합니다.", telegramTitle: "Telegram으로 문의", telegramHint: "가장 빠른 답변 · 직접 응답", emailHint: "이메일은 항상 확인하지 않습니다", copyEmail: "이메일 복사", openEmail: "이메일 열기", howItWorks: "Video Toolkit 작동 방식", detailDownloadTitle: "실제 미디어 파일 다운로드", detailDownloadBody: "X와 Google Drive에서 최적의 동영상 소스를 찾아 Chrome 다운로드로 전달합니다.", detailTranscriptTitle: "Mac에서 로컬 받아쓰기", detailTranscriptBody: "네이티브 호스트가 NVIDIA Parakeet을 로컬로 실행하고 결과를 검증해 깨끗한 텍스트를 반환합니다.", detailHistoryTitle: "작은 로컬 라이브러리", detailHistoryBody: "최근 받아쓰기는 선택한 기간 동안 브라우저에 남으며 언제든 지울 수 있습니다.", viewSource: "GitHub에서 소스 보기", footerLocal: "로컬 및 비공개", footerUpdated: "2026년 7월 14일 업데이트",
  historyEmptyTitle: "아직 받아쓰기가 없습니다", historyEmptyBody: "지원되는 동영상을 열고 받아쓰기하면 최근 결과가 여기에 표시됩니다.", copyTranscript: "받아쓰기 복사", copyTimestamps: "타임스탬프와 함께 복사", downloadTxt: "TXT 다운로드", downloadSrt: "SRT 다운로드", openSource: "원본 열기", copyLink: "원본 링크 복사", transcribing: "{id} 받아쓰기 중… 몇 분 걸릴 수 있습니다.", downloadingVideo: "{id} 다운로드를 시작하는 중…", cachedCopied: "저장된 받아쓰기를 복사했습니다. {duration} 동안 더 사용할 수 있습니다.", transcriptCopied: "받아쓰기를 검증하고 저장한 뒤 복사했습니다.", videoDownloadStarted: "동영상 다운로드를 시작했습니다.", transcriptDownloadStarted: "받아쓰기 다운로드를 시작했습니다.", settingsSaved: "설정을 저장했습니다.", historyCleared: "기록을 지웠습니다.", copiedItem: "{id} 받아쓰기를 복사했습니다.", copiedTimedItem: "{id} 타임스탬프 받아쓰기를 복사했습니다.", downloadingItem: "{id} 받아쓰기를 다운로드 중입니다.", downloadingSrt: "{id} 자막을 다운로드 중입니다.", openedSource: "원본 페이지를 열었습니다.", linkCopied: "원본 링크를 복사했습니다.", emailCopied: "이메일 주소를 복사했습니다."
};

const it = {
  brandTagline: "Scarica · Trascrivi", toggleTheme: "Cambia tema", tabHome: "Home", tabSettings: "Impostazioni", tabAbout: "Info", checkingPage: "Controllo della pagina", detectingVideo: "Ricerca di un video supportato…", currentVideo: "Video {platform} · {id}", sourceX: "Video X attuale", sourceDrive: "Video Drive attuale", noSupportedVideo: "Apri un video su X o Google Drive", platformX: "X", platformDrive: "Drive", transcribeVideo: "Trascrivi video", copyExisting: "Copia trascrizione", transcribeHint: "Parakeet locale · copia automatica", downloadVideo: "Scarica video", downloadHint: "Migliore qualità disponibile", saveCurrentTranscript: "Salva la trascrizione attuale come .txt", libraryEyebrow: "La tua raccolta", recentTranscripts: "Trascrizioni recenti", clearHistory: "Cancella", clearConfirm: "Premi di nuovo",
  preferencesEyebrow: "Preferenze", settingsTitle: "Trascrizioni su misura", settingsIntro: "Queste opzioni valgono per testo copiato, file TXT e cronologia locale.", outputTitle: "Output trascrizione", outputSubtitle: "Scegli cosa copiare e salvare.", includeTitle: "Includi titolo del video", includeTitleHint: "Inserisce il titolo del post o file sopra la trascrizione.", timestamps: "Timestamp", timestampsOff: "Senza timestamp", timestamps10: "Ogni ~10 secondi", timestamps30: "Ogni ~30 secondi · utile per IA", timestamps60: "Ogni ~60 secondi", timestampsAll: "Ogni frase", timestampsHint: "Puoi scaricare i sottotitoli SRT se la trascrizione contiene dati temporali.", historySettings: "Cronologia", historySubtitle: "Salvata solo in questo browser.", maxItems: "Numero massimo", retention: "Conserva per", retentionUnit: "Unità di conservazione", days: "giorni", hours: "ore", localPrivacyTitle: "Locale per scelta.", localPrivacyBody: "La trascrizione usa l'host nativo e la cronologia resta in Chrome.", saveSettings: "Salva impostazioni",
  aboutIntro: "Salva il video originale o trasforma la voce in testo pulito e ricercabile, senza inviare i media a un servizio cloud.", contactEyebrow: "Domande o hai trovato un bug?", contactTitle: "Parla con chi l'ha creato", contactBody: "Bug, idee, miglioramenti o collaborazioni: scrivimi su Telegram. Leggo ogni messaggio e rispondo personalmente.", telegramTitle: "Scrivi su Telegram", telegramHint: "Risposta più rapida · rispondo io", emailHint: "Non controllo sempre l'email", copyEmail: "Copia email", openEmail: "Apri email", howItWorks: "Come funziona Video Toolkit", detailDownloadTitle: "Scarica il vero file multimediale", detailDownloadBody: "Su X e Google Drive, l'estensione trova la migliore sorgente video e la passa ai Download di Chrome.", detailTranscriptTitle: "Trascrive sul tuo Mac", detailTranscriptBody: "L'host nativo esegue NVIDIA Parakeet in locale, verifica il risultato e restituisce testo pulito.", detailHistoryTitle: "Mantiene una piccola raccolta locale", detailHistoryBody: "Le trascrizioni recenti restano nel browser per il periodo scelto. Puoi cancellarle quando vuoi.", viewSource: "Vedi il codice su GitHub", footerLocal: "Locale e privato", footerUpdated: "Aggiornato il 14 lug 2026",
  historyEmptyTitle: "Nessuna trascrizione", historyEmptyBody: "Apri un video supportato e trascrivilo. I risultati recenti appariranno qui.", copyTranscript: "Copia trascrizione", copyTimestamps: "Copia con timestamp", downloadTxt: "Scarica TXT", downloadSrt: "Scarica SRT", openSource: "Apri origine", copyLink: "Copia link", transcribing: "Trascrizione di {id}… Potrebbero servire alcuni minuti.", downloadingVideo: "Avvio del download per {id}…", cachedCopied: "Trascrizione salvata copiata. Resterà disponibile per {duration}.", transcriptCopied: "Trascrizione verificata, salvata e copiata.", videoDownloadStarted: "Download del video avviato.", transcriptDownloadStarted: "Download della trascrizione avviato.", settingsSaved: "Impostazioni salvate.", historyCleared: "Cronologia cancellata.", copiedItem: "Trascrizione copiata per {id}.", copiedTimedItem: "Trascrizione con timestamp copiata per {id}.", downloadingItem: "Download della trascrizione per {id}.", downloadingSrt: "Download dei sottotitoli per {id}.", openedSource: "Pagina di origine aperta.", linkCopied: "Link di origine copiato.", emailCopied: "Indirizzo email copiato."
};

const pt = {
  brandTagline: "Transferir · Transcrever", toggleTheme: "Alternar tema", tabHome: "Início", tabSettings: "Definições", tabAbout: "Informações", checkingPage: "A verificar a página", detectingVideo: "A procurar um vídeo compatível…", currentVideo: "Vídeo do {platform} · {id}", sourceX: "Vídeo X atual", sourceDrive: "Vídeo Drive atual", noSupportedVideo: "Abra um vídeo no X ou Google Drive", platformX: "X", platformDrive: "Drive", transcribeVideo: "Transcrever vídeo", copyExisting: "Copiar transcrição", transcribeHint: "Parakeet local · cópia automática", downloadVideo: "Transferir vídeo", downloadHint: "Melhor qualidade disponível", saveCurrentTranscript: "Guardar a transcrição atual como .txt", libraryEyebrow: "A sua biblioteca", recentTranscripts: "Transcrições recentes", clearHistory: "Limpar", clearConfirm: "Clique novamente",
  preferencesEyebrow: "Preferências", settingsTitle: "Transcrições à sua medida", settingsIntro: "Estas opções aplicam-se ao texto copiado, ficheiros TXT e histórico local.", outputTitle: "Saída da transcrição", outputSubtitle: "Escolha o que é copiado e guardado.", includeTitle: "Incluir título do vídeo", includeTitleHint: "Coloca o título da publicação ou ficheiro acima da transcrição.", timestamps: "Marcas de tempo", timestampsOff: "Sem marcas de tempo", timestamps10: "A cada ~10 segundos", timestamps30: "A cada ~30 segundos · útil para IA", timestamps60: "A cada ~60 segundos", timestampsAll: "Em cada frase", timestampsHint: "Ainda pode transferir legendas SRT quando existirem dados temporais.", historySettings: "Histórico", historySubtitle: "Guardado apenas neste navegador.", maxItems: "Máximo de itens", retention: "Guardar por", retentionUnit: "Unidade de retenção", days: "dias", hours: "horas", localPrivacyTitle: "Local por definição.", localPrivacyBody: "A transcrição usa o host nativo e o histórico permanece no Chrome.", saveSettings: "Guardar definições",
  aboutIntro: "Guarde o vídeo original ou transforme a fala em texto limpo e pesquisável, sem enviar os média para um serviço de transcrição na nuvem.", contactEyebrow: "Dúvidas ou encontrou um erro?", contactTitle: "Fale com quem criou", contactBody: "Erros, ideias, melhorias ou colaboração — envie mensagem no Telegram. Leio todas e respondo pessoalmente.", telegramTitle: "Mensagem no Telegram", telegramHint: "Resposta mais rápida · respondo pessoalmente", emailHint: "Nem sempre verifico o email", copyEmail: "Copiar email", openEmail: "Abrir email", howItWorks: "Como funciona o Video Toolkit", detailDownloadTitle: "Transfere o ficheiro multimédia real", detailDownloadBody: "No X e Google Drive, a extensão encontra a melhor fonte de vídeo e envia-a para as Transferências do Chrome.", detailTranscriptTitle: "Transcreve no seu Mac", detailTranscriptBody: "O host nativo executa NVIDIA Parakeet localmente, verifica o resultado e devolve texto limpo.", detailHistoryTitle: "Mantém uma pequena biblioteca local", detailHistoryBody: "As transcrições recentes ficam no navegador durante o período escolhido. Pode limpá-las quando quiser.", viewSource: "Ver código no GitHub", footerLocal: "Local e privado", footerUpdated: "Atualizado em 14 jul 2026",
  historyEmptyTitle: "Ainda não há transcrições", historyEmptyBody: "Abra um vídeo compatível e transcreva-o. Os resultados recentes aparecerão aqui.", copyTranscript: "Copiar transcrição", copyTimestamps: "Copiar com marcas", downloadTxt: "Transferir TXT", downloadSrt: "Transferir SRT", openSource: "Abrir origem", copyLink: "Copiar ligação", transcribing: "A transcrever {id}… Pode demorar alguns minutos.", downloadingVideo: "A iniciar a transferência de {id}…", cachedCopied: "Transcrição guardada copiada. Ficará disponível por {duration}.", transcriptCopied: "Transcrição verificada, guardada e copiada.", videoDownloadStarted: "Transferência do vídeo iniciada.", transcriptDownloadStarted: "Transferência da transcrição iniciada.", settingsSaved: "Definições guardadas.", historyCleared: "Histórico limpo.", copiedItem: "Transcrição copiada para {id}.", copiedTimedItem: "Transcrição com marcas copiada para {id}.", downloadingItem: "A transferir a transcrição de {id}.", downloadingSrt: "A transferir as legendas de {id}.", openedSource: "Página de origem aberta.", linkCopied: "Ligação de origem copiada.", emailCopied: "Endereço de email copiado."
};

export const TRANSLATIONS = { en, ru, es, zh, ja, ko, it, pt };

export function detectLanguage() {
  const code = String(navigator.language || "en").toLowerCase().split("-")[0];
  return LANGUAGES.some((language) => language.code === code) ? code : "en";
}

export function translate(language, key, values = {}) {
  const template = TRANSLATIONS[language]?.[key] || en[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ""));
}
