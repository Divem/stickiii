# 贴贴便签公众号文章图片生成提示词

生成方式：内置 GPT Image / image_gen。每张图独立生成；配图一通过内置编辑流程修正快捷键后交付。

## 公众号封面

文件：00-cover.png

```text
Use case: ads-marketing. Asset type: WeChat article cover, very wide landscape canvas EXACT aspect ratio 2.35:1, target 2350 x 1000 pixels, NOT 16:9, not a square.
Premium editorial product-launch artwork for the Chinese desktop app 贴贴便签. Consistent warm ivory #f7f5ec background, forest green #243832 typography, chartreuse #d8f278 notes and muted sage accents. Tactile matte paper combined with restrained soft 3D clay objects, soft studio shadows, exceptionally clean composition and generous breathing room. The brand mascot is an adorable lime-green rounded square note with a curled upper-right corner, two sage pages peeking behind, big dark oval eyes with highlights, peach blush, curved smile, tiny arms and feet, and a dark green round checkmark badge low on its body. Friendly and useful, sophisticated rather than childish. Chinese typography is crisp dark-green bold sans-serif; no watermark, no decorative nonsense text, no official Feishu logo, no invented screenshots, no configuration forms, no code/API/provider details.
Primary request: a memorable launch cover communicating ideas can be captured anywhere and manually sent into Feishu documents. Put the essential composition in the CENTER SQUARE crop-safe region spanning x=29% to x=71% of the canvas: a small centered brand line, then two extremely legible large headline lines, then the recognizable waving note mascot beside a compact note/document vignette below. Everything needed to understand the product remains visible in a central 1:1 thumbnail crop. Make the title dominant, not the mascot. Supporting paper-note shapes and abstract browser/meeting/code window cards can extend to the far left, with a structured document stack and gentle connecting path to the far right; these are secondary atmosphere. No person, no laptop product photo. Refined magazine cover, high contrast at small thumbnail size.
Text (verbatim), only these 3 lines:
"贴贴便签"
"随时记下想法"
"一键写入飞书"
Constraints: Render Chinese exactly. Clear title hierarchy. One finished single cover, no contact sheet, no frames, no embedded crop guide, no badges, no dates, no download URL. Opaque background.
```

## 配图一：随时记录

文件：01-capture-anywhere.png

```text
Use case: illustration-story. Asset type: WeChat article chapter illustration, landscape 16:9, target 1600 x 900.
Premium editorial product-launch artwork for the Chinese desktop app 贴贴便签. Consistent warm ivory #f7f5ec background, forest green #243832 typography, chartreuse #d8f278 notes and muted sage accents. Tactile matte paper combined with restrained soft 3D clay objects, soft studio shadows, exceptionally clean composition and generous breathing room. The brand mascot is an adorable lime-green rounded square note with a curled upper-right corner, two sage pages peeking behind, big dark oval eyes with highlights, peach blush, curved smile, tiny arms and feet, and a dark green round checkmark badge low on its body. Friendly and useful, sophisticated rather than childish. Chinese typography is crisp dark-green bold sans-serif; no watermark, no decorative nonsense text, no official Feishu logo, no invented screenshots, no configuration forms, no code/API/provider details.
Primary request: show a small foreground sticky-note window accessible over any desktop work context. A clean scene of three overlapping abstract desktop windows: meeting grid, browser article, code editor. They use graphical placeholder blocks rather than fake readable UI. In front, a pale chartreuse compact note card with just two hand-entered lines and a small stylized shortcut-key cluster. The same friendly note mascot stands beside the card, gesturing towards it. The work context remains visible around the note: capture an idea, then continue work. No arrows out to cloud here.
Composition: ample ivory breathing room; title centered across upper margin; three background windows labeled distinctly and legibly; foreground note centered and largest; mascot slightly below and beside it, smaller than the note.
Text (verbatim), only these:
Title "想到就记，记完继续"
Three context labels "开会" "看网页" "写代码"
Foreground note "项目想法" and "明天讨论"
Constraints: illustrated concept, no photorealistic screenshot, no auto-capture, no drag/drop files. Render Chinese exactly. One standalone illustration.
```

## 配图二：飞书的两种整理方式

文件：02-feishu-two-modes.png

```text
Use case: infographic-diagram. Asset type: WeChat article educational chapter image, landscape 16:9, target 1600 x 900.
Premium editorial product-launch artwork for the Chinese desktop app 贴贴便签. Consistent warm ivory #f7f5ec background, forest green #243832 typography, chartreuse #d8f278 notes and muted sage accents. Tactile matte paper combined with restrained soft 3D clay objects, soft studio shadows, exceptionally clean composition and generous breathing room. The brand mascot is an adorable lime-green rounded square note with a curled upper-right corner, two sage pages peeking behind, big dark oval eyes with highlights, peach blush, curved smile, tiny arms and feet, and a dark green round checkmark badge low on its body. Friendly and useful, sophisticated rather than childish. Chinese typography is crisp dark-green bold sans-serif; no watermark, no decorative nonsense text, no official Feishu logo, no invented screenshots, no configuration forms, no code/API/provider details.
Primary request: exceptionally clear diagram of exactly TWO alternatives for manually writing notes into Feishu documents. Two spacious horizontal rounded ivory panels stacked vertically. Title across top.
UPPER PANEL: label "每条笔记，一篇文档". Three small chartreuse/sage note cards on the left, each individually connects by a separate rightward arrow to its own separate document page on the right. Three notes, THREE DISTINCT documents. Matching tiny letters A/B/C make the one-to-one relationship unambiguous. Document pages are distinct with clean gaps, never merged.
LOWER PANEL: label "多条笔记，同一篇文档". Three separate note cards on the left, matching A/B/C, with three arrows CONVERGING on ONE single large document on the right. Inside that one document show three clearly separated chapters labeled A, B, C. Three notes, ONE document, THREE chapter sections. No secondary whole documents behind this one: show it plainly as a single page.
Text (verbatim): top title "两种方式，写入飞书"; upper panel "每条笔记，一篇文档"; lower panel "多条笔记，同一篇文档"; small note label "笔记"; small destination label "飞书文档"; letters A B C. No other copy. A small brand mascot can stand at the far bottom margin, outside diagram and without obscuring any arrow.
Constraints: exact count and mapping accuracy is paramount. Arrows point only from notes to documents, not bidirectional. Never imply auto-sync. Native Chinese typography, generous layout. One finished diagram, no split image exports.
```

## 配图三：从随手记到完整文档

文件：03-notes-to-document.png

```text
Use case: productivity-visual. Asset type: WeChat chapter workflow illustration, landscape 16:9, target 1600 x 900.
Premium editorial product-launch artwork for the Chinese desktop app 贴贴便签. Consistent warm ivory #f7f5ec background, forest green #243832 typography, chartreuse #d8f278 notes and muted sage accents. Tactile matte paper combined with restrained soft 3D clay objects, soft studio shadows, exceptionally clean composition and generous breathing room. The brand mascot is an adorable lime-green rounded square note with a curled upper-right corner, two sage pages peeking behind, big dark oval eyes with highlights, peach blush, curved smile, tiny arms and feet, and a dark green round checkmark badge low on its body. Friendly and useful, sophisticated rather than childish. Chinese typography is crisp dark-green bold sans-serif; no watermark, no decorative nonsense text, no official Feishu logo, no invented screenshots, no configuration forms, no code/API/provider details.
Primary request: show a simple left-to-right THREE-stage workflow from rough note to improved expression to Feishu document. Stage 1: several small green paper snippets with fragmentary graphically represented handwriting. Stage 2: one tidy note sheet, with a small restrained AI sparkle mark and neatly spaced text blocks, the note mascot holding a pencil beside it. Stage 3: one tall structured ivory/green Feishu document page with a title and three section blocks, grown from the note. Simple tasteful rightward connectors between stages; represent human-triggered steps, not continuous background automation. Small looping arrow from an extra note snippet to an existing chapter on the final document conveys later additions update original position rather than producing duplicate docs. No output file attachments, no official Feishu logo.
Text (verbatim), only these:
Top headline "从零散想法，到完整文档"
Stage labels "随手记录" "AI 润色" "写入飞书"
Bottom small caption "后续补充，更新原位置"
Composition: editorial horizontal workflow, large coherent icons with clean negative space, typography remains legible on a phone, consistent brand mascot and paper materials. No exaggerated AI robot, no fake auto summarization, no dense microcopy. One standalone image.
```

## 配图一最终修正提示词

```text
Use case: text-localization. Input image: edit target, the existing 16:9 green mascot desktop-work illustration. Make ONE precise correction only: the shortcut keycaps on the foreground green note currently say "Ctrl + Shift + N", which is wrong. Change ONLY those keycaps to read EXACTLY "Ctrl + Shift + Space", increasing the width of the final keycap within the same note surface as needed so "Space" is clear and correctly spelled. The keycaps must read Ctrl, Shift, Space in that order, separated by plus signs. Everything else is invariant: preserve the original title "想到就记，记完继续", the three background windows labeled "开会" "看网页" "写代码", the note lines "项目想法" and "明天讨论", the original mascot identity, poses, plants, lighting, palette, image aspect ratio and composition. No extra text. No reimagining. One finished corrected illustration. Opaque background.
```

