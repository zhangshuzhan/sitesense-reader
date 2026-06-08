<div align="right">
  <a href="README.md">English</a> |
  <a href="README_zh.md">简体中文</a> |
  <a href="README_ru.md">Русский</a> |
  <a href="README_es.md">Español</a> |
  <a href="README_fr.md">Français</a> |
  <strong>العربية</strong>
</div>

<p align="center">
  <img src="icon.svg" width="128" height="128" alt="RSS Reader Logo">
</p>

<h1 align="center">RSS Reader</h1>

<p align="center">
  <strong>قارئ RSS مكتبي محلي أولاً مع أدوات ذكاء اصطناعي اختيارية.</strong>
</p>

<p align="center">
  <a href="https://github.com/JinxinWonderWorld/RSS-Reader/releases"><img src="https://img.shields.io/github/v/release/JinxinWonderWorld/RSS-Reader?color=blue&label=%D8%AA%D9%86%D8%B2%D9%8A%D9%84" alt="Releases"></a>
  <img src="https://img.shields.io/badge/Version-0.2.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/Platform-macOS-lightgrey" alt="Platform">
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Built_with-Tauri_2-24C8DB?logo=tauri&logoColor=white" alt="Tauri"></a>
</p>

<p align="center">
  <a href="#نظرة-عامة">نظرة عامة</a> •
  <a href="#الميزات">الميزات</a> •
  <a href="#الجديد-في-020">الجديد</a> •
  <a href="#التنزيل">التنزيل</a> •
  <a href="#التطوير">التطوير</a> •
  <a href="#البنية">البنية</a>
</p>

---

<p align="center">
  <img src="imgs/screenshot.png" alt="RSS Reader screenshot" width="800">
</p>

## نظرة عامة

RSS Reader هو تطبيق سطح مكتب مبني على Tauri 2 لقراءة خلاصات RSS و Atom و JSON. يخزن البيانات محلياً في SQLite، ويجعل تحديث الخلاصات أكثر كفاءة باستخدام الطلبات الشرطية، ويضيف مسارات ذكاء اصطناعي اختيارية للتلخيص والترجمة وتقييم المقالات.

يتبع التطبيق أسلوب macOS الأصلي: `Command+W` يغلق النافذة مع بقاء التطبيق نشطاً في Dock، و `Command+Q` يغلق التطبيق بالكامل.

## الميزات

### القراءة وإدارة الخلاصات
- الاشتراك في خلاصات RSS و Atom و JSON.
- استيراد وتصدير الاشتراكات باستخدام OPML.
- تصفح كل المقالات، غير المقروءة، المميزة بنجمة، والمفضلة.
- تنظيم المقالات باستخدام الخلاصات والوسوم والمجموعات.
- بحث نصي كامل محلي داخل المقالات.
- قوائم افتراضية للتعامل مع مجموعات مقالات كبيرة.

### الأداء والعمل في الخلفية
- تخزين المقالات والخلاصات والقواعد والإعدادات محلياً.
- استخدام `ETag` و `Last-Modified` لتخطي الخلاصات غير المتغيرة.
- تحديث الخلاصات في Rust مع حد للتوازي.
- إبقاء مجدول خلفي خفيف عند إغلاق النافذة الرئيسية.
- إيقاف مهام الواجهة الثقيلة ومهام الذكاء الاصطناعي الثقيلة عند عدم وجود نافذة مفتوحة.
- تحميل عرض المقالات وتنظيف HTML وتحليل Markdown وتلوين الكود عند الحاجة فقط.
- استخدام وكيل `rss-media://` محدود للوسائط التي تحتاج إلى تخزين مؤقت أو طلبات Range.
- تحميل الفيديوهات المضمنة فقط بعد إجراء من المستخدم.

### أدوات ذكاء اصطناعي اختيارية
- إعداد ملفات تعريف متوافقة مع OpenAI أو Anthropic.
- إنشاء ملخص لمقال واحد.
- ترجمة محتوى المقالات.
- إنشاء ملخصات دفعية لعدة مقالات.
- استخدام قواعد الأتمتة وتقييم الذكاء الاصطناعي لتصنيف المقالات أو إبرازها.
- تبقى مفاتيح API في إعدادات التطبيق المحلية.

### تجربة سطح المكتب
- سلوك قائمة macOS أصلي للإغلاق وإعادة الفتح والإخفاء والخروج.
- اختصارات لوحة مفاتيح مع مفتاح تشغيل أو إيقاف في الإعدادات.
- سمات فاتحة وداكنة واتباع النظام.
- قوائم سياقية وإجراءات دفعية للمقالات.
- واجهة بالإنجليزية والصينية والروسية والإسبانية والفرنسية والعربية.

## الجديد في 0.2.0

- دورة حياة macOS القياسية: `Command+W` يغلق النافذة، و `Command+Q` يخرج من التطبيق.
- تقليل استهلاك الموارد في حالة الإخفاء عبر تدمير WebView عند إغلاق النافذة.
- تحديث وتنظيف خلفي مدعومان من Rust.
- جلب شرطي للخلاصات باستخدام `ETag` و `Last-Modified`.
- عرض مؤجل للمقالات وتحميل وسائط أخف.
- إضافة مفتاح لتفعيل أو تعطيل اختصارات لوحة المفاتيح في الإعدادات.
- إصلاحات لاستعادة المسار، والتنقل من الإعدادات، وتحديث عدادات الخلاصات، ومزامنة حالة القراءة.

## التنزيل

تُنشر الإصدارات الجاهزة للاستخدام في صفحة [GitHub Releases](https://github.com/JinxinWonderWorld/RSS-Reader/releases).

هدف الإصدار الحالي هو macOS. ما زال دعم Windows و Linux موجوداً في إعدادات Tauri، لكن اختبار الإصدارات يركز حالياً على macOS.

## التطوير

### المتطلبات
- [Node.js](https://nodejs.org/) 18 أو أحدث
- [Rust](https://www.rust-lang.org/tools/install) 1.70 أو أحدث

### البدء السريع

```bash
git clone https://github.com/JinxinWonderWorld/RSS-Reader.git
cd RSS-Reader
npm install
npm run tauri:dev
```

### أوامر مفيدة

| الأمر | الوصف |
| --- | --- |
| `npm run dev` | تشغيل واجهة Vite فقط |
| `npm run build` | فحص الأنواع وبناء الواجهة |
| `npm run tauri:dev` | تشغيل تطبيق Tauri الكامل في وضع التطوير |
| `npm run tauri:build` | بناء حزمة الإصدار |
| `npm test -- --run` | تشغيل اختبارات الواجهة |
| `npm run lint` | تشغيل ESLint |
| `cargo test --manifest-path src-tauri/Cargo.toml` | تشغيل اختبارات Rust |

## البنية

- `src-tauri/src/app_runtime.rs`: حالة runtime والجدولة الخلفية وبوابات التنظيف.
- `src-tauri/src/window_lifecycle.rs`: إغلاق نافذة macOS وإعادة فتحها واستعادة حالتها.
- `src-tauri/src/feed/`: جلب الخلاصات والطلبات الشرطية والتحليل.
- `src-tauri/src/db/`: مخطط SQLite والوصول إلى البيانات.
- `src-tauri/src/media_protocol.rs`: وكيل وسائط محدود واستجابات Range.
- `src-tauri/src/ai.rs`: ملخصات وترجمة وملخصات دفعية ومعالجة طابور الذكاء الاصطناعي.
- `src/services/runtime.ts`: جسر الواجهة إلى أوامر Rust runtime.
- `src/stores/`: مخازن Zustand للخلاصات والإعدادات والقواعد وحالة الواجهة وسجل البحث.
- `src/components/`: مكونات React وعرض المقالات المحمل عند الحاجة.
