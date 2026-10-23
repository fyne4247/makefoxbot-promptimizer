---
name: make
description: Turn rough or jumbled image ideas into complete MakeFox tag prompts, apply model-specific syntax, resolve matching catalog LoRAs and triggers, separate multiple subjects cleanly, and optionally hand the finished command to MakeFoxBot.
version: 2.0.1
user-invocable: true
metadata: {"short-description":"Build MakeFox prompts with catalog LoRA lookup","platform":"openclaw"}
---

# MakeFox Prompt Formatter

Convert freeform requests into complete, copy-ready MakeFox commands. Preserve the user's intended subjects, relationships, actions, mood, framing, and visual direction while translating prose into concise comma-separated booru-style tags.

Most supported MakeFox models are best prompted with tags rather than conversational sentences. Translate natural-language requests into concise tags, subject to model-specific exceptions.

## HARD RULE: never generate images

This skill only **rewrites prompts**. It never produces images.

- **Never call `image_generate`, `video_generate`, `music_generate`, or any generation tool.**
- **Never start an image-generation task, background or otherwise.**
- Do not list image providers, do not check image models, do not "offer to generate."
- The deliverable is always the formatted text commands in a fenced block (see Required visible result).
- If the user asks you to generate the image yourself, decline and explain that you only format prompts; they can run the commands in MakeFoxBot.
- The only optional action beyond formatting is sending the finished commands to the established MakeFoxBot conversation, and only when the user explicitly asks to send them.

## Interpret the request

Extract, without inventing:

- named characters and species;
- gender or presentation and body traits when supplied;
- clothing, props, expressions, poses, and actions;
- which traits or actions belong to which subject;
- relationships and interactions between subjects;
- setting, time, weather, lighting, camera angle, framing, and composition;
- requested model family, style, LoRA, wildcard, weight, seed, or generation setting;
- exclusions introduced with words such as “no,” “without,” or “avoid”;
- whether the user wants only a formatted prompt or also wants it sent.

Remove conversational filler, politeness, repetition, and vague intensifiers. Preserve unusual or explicit intent accurately. Do not add unrequested characters, actions, anatomy, outfits, locations, props, styles, or relationship dynamics.

If the request is underspecified but still actionable, make the smallest reasonable assumption. Ask one focused question only when guessing would materially change the subject, interaction, composition, or model compatibility.

## Prompt anatomy

Build prompts in exactly this order — this is the canonical ordering rule from the MakeFox Prompting 101 guide. Do not add intermediate stages or split steps:

1. **Subject** — identity, species, gender/count. e.g. `fox, male`
2. **Looks & clothing** — appearance, anatomy, clothing. e.g. `wizard hat`
3. **Pose & action** — pose, expression, action. e.g. `sitting, casting spell`
4. **Setting** — location, time, weather, lighting. e.g. `forest, night, moonlight`
5. **Quality & style** — one coherent style and quality direction. e.g. `detailed background`

Relationship/interaction tags (e.g. `holding hands`, `fighting`) belong inside the pose/action stage or with the subject — never as a separate middle stage between Setting and Quality.

A compact example:

```text
/g fox, male, wizard hat, sitting, casting spell, forest, night, moonlight, detailed background
```

One vague tag leaves most decisions to the model. Add concrete details that express the user's intent, but avoid bloated tag lists and conflicting style soup.

Convert prose into tags rather than copying it:

- “a really beautiful heroic wolf standing on a mountain at sunset” becomes `wolf, male, muscular, heroic pose, standing, mountain, sunset, dramatic lighting, detailed fur`;
- do not retain filler such as “a picture of,” “please,” “really,” or “very”;
- repeating `cute` several times is not useful emphasis; use distinct supporting tags such as `young, chibi, big eyes, fluffy`.

## Negative prompting

Move unwanted concepts into the negative command. Do not leave phrases such as `no scars`, `not scary`, or `without text` in the positive prompt, because the positive side may react to the unwanted concept itself.

Translate desired opposites positively when the intent is clear. For example:

- positive: `friendly, smiling, bright colors, pastel`;
- negative: `dark, scary, evil, horror`.

When the user supplies no negatives, **do not emit a `/setnegative` line.** Only provide negatives when the user explicitly asks for them or supplies things to avoid. If the user does ask for negatives, use this conservative starter and tune it to the scene:

```text
/setnegative blurry, bad anatomy, extra limbs, deformed, watermark, text
```

Weights also work in negatives, but strengthen only a recurring problem. An empty `/setnegative` clears the stored negative list, so never emit it accidentally.

## Model dialects and compatibility

Use the model the user selected. Do not silently switch models.

- Most Illustrious, NoobAI, and ordinary furry models use plain comma-separated e621 or danbooru-style tags. Quality tags such as `masterpiece, best quality` may help, but do not pile on redundant quality soup.
- Pony-family models need `score_9, score_8_up, score_7_up` followed by `source_furry` or `source_anime` before ordinary tags.
- Lightning-family models are designed for low steps, roughly 8–12, and low CFG, roughly 2.5. Mention this when relevant; do not silently change saved settings.
- MondAI-family models strongly prefer booru tags and are especially harmed by full sentences.
- A sudden quality drop after changing models often indicates the wrong prompting dialect rather than a bad concept.

Never inject an Illustrious LoRA into Pony, Anima, Animagine, or another incompatible family. Crossing LoRA base-model families commonly causes weak, muddy, or broken output.

## Tag vocabulary

Use the available e621-derived vocabulary as a guide, not as proof of what a particular image model learned. Avoid inventing supposed canonical e621 tags; a valid e621 tag is not necessarily recognized by every MakeFox checkpoint. Consult the bundled tag catalog whenever a candidate word is uncertain, uncommon, or stylized.

To look up whether a tag exists and how it is actually spelled, run:

```bash
node scripts/lookup-tag.js <candidate term>
```

The lookup helper is a two-stage pipeline:

1. It matches the term against the full canonical tag catalog (exact first, then word-boundary prefixes ranked by `post_count`).
2. It runs every result through the active alias map, returning **only the final canonical tags** — no arrows, no notes, no intermediate names.

Output rules (already applied by the helper — keep them when writing the prompt):

- Names come back **space-separated** (`detailed background`), because MakeFox expects spaces. Never re-add underscores.
- Parentheses in tag names are escaped with backslashes (`dragon \(dnd\)`) so MakeFox does not read them as weight syntax.
- Deprecated or banned names resolve to their canonical alias: `cub` → `young`, `boobs` → `breasts`. Use the resolved name in the prompt, not the input term.
- If the helper returns several near-identical names, the first is the best-established token (highest `post_count`); prefer it.
- If a concept has no match, do not fabricate a tag: re-word into the nearest real tag, or leave it out.
- For **every explicitly named character**, consult the LoRA catalog as well (`node scripts/lookup-lora.js <name>`), even if a matching e621 tag exists. The same phrase can name both a general feature and a character (for example, `scar`). Inspect category information with `--explain` rather than treating the general tag as proof that the character is covered. Never invent a LoRA token if neither catalog provides the needed identity.
- The LoRA catalog and this tag catalog are separate; a tag lookup is not a LoRA lookup — but they are sequential stages of the same character-resolution pipeline.
- When a term is ambiguous, run `node scripts/lookup-tag.js --explain "term"` to inspect e621 category and popularity. If implications have been imported, the same output includes directly implied tags. Do not automatically append every implied tag to prompts: they may be redundant, unhelpful, or contradictory in the target checkpoint. Artist, character, and copyright tags are available for explicit identification and implication relationships, but generic autocomplete favors general, species, and lore tags.
- Refresh the vocabulary from the current e621 public export manifest with `python3 scripts/update-e621.py`. The default import covers general, artist, copyright, character, species, and lore categories, plus active aliases and implications. This process does not refresh MakeFox LoRAs; they have their own collector.

## LoRA catalog resolution

Use the **shared MakeFox catalog** when the user names a character or explicitly requests a style, concept, object, pose, action, or background. Only add a LoRA after confirming the user's intended model family and a credible match.

Run `node scripts/lookup-lora.js --model <base-family> <search terms>` for each named subject/concept. If the user's base family is unspecified, run an unfiltered lookup and **show the compatible options rather than guessing**. Lookup results disclose source family and metadata; never silently choose a cross-family LoRA.

- Match case-insensitively using names, distinctive title phrases, provided aliases, and distinctive triggers. Use filename matches only where appropriate.
- Favor exact character or concept name matches over partial titles. Ask for a choice only when several plausible, compatible LoRAs remain; don't treat ranking as proof of identity.
- **Default for two or more named characters: prefer one compatible multi-character LoRA that explicitly covers the *entire* requested cast.** In actual MakeFox use, a joint Lion King LoRA has produced more distinct characters than stacking separate character LoRAs. Treat this as an observed preference, not a universal guarantee.
- Run `node scripts/lookup-lora.js --model Illustrious "Simba" "Scar"` with one argument per character. Check `multi_character.recommended` (or `preferred_combined[0]`) **before** using the independent matches in `results`.
- Only select a combined model if the documented cast covers **every** named subject, and its base family matches the user's selected model. A LoRA covering two out of three requested characters is not a full-scene substitute.
- If several combined LoRAs cover the full cast, prefer the one containing fewer unrelated characters, unless the user specifies a particular variant or LoRA.
- When a combined LoRA is selected, emit **one LoRA token for those characters**, with the relevant per-character trigger words. Do not stack separate character LoRAs on top of it unless explicitly requested; adding them reintroduces competing global influences.
- Example using the bundled Lion King multi-character entry for Simba and Scar: `/g 2 lions, <lora:The_Lion_King_Lora_illustrious:1>, simba, uncle scar, standing together, savanna, sunset`. Here `simba` and `uncle scar` are the record's character triggers; do not append the entire catalog list of unrelated characters.
- If no single LoRA covers the requested cast, retain separate character options rather than inventing a combined token. Explain briefly that multiple character LoRAs can cause identity bleed; they are still permissible if the user requests them.
- Respect explicit user choices of individual LoRAs, even if a combined LoRA is available. Never swap to a different character age or other specific variant simply because a combined LoRA exists.
- Copy the catalog's **literal** `lora_syntax` token, including both `<` and `>`, without changing the filename. The catalog weight, usually `1`, is a starting point; adjust it only when requested or troubleshooting.
- Use supplied trigger words as relevant, not necessarily every tag in a long example list. Keep distinctive activation tokens intact. Some LoRAs have no known trigger words.
- Never synthesize a LoRA token when the catalog lacks a filename or syntax. Report that it is unknown.
- Do not infer artist, anatomy, pose, or background LoRAs merely from generic tags. Add these only when the user asks for the concept or LoRA.
- Catalog files may be incomplete or stale. A missing match does not prove MakeFox lacks the LoRA. Continue with plain tags and mention the limitation briefly.

The bundled `references/loras.json` is a **partial seed** until replaced with a verified full catalog export. Use the catalog collector or importer described in `README.md` to replace it. Do not describe it as comprehensive until coverage is verified.

A LoRA loads learned information; distinctive trigger words can help activate the intended part of its training. For a multi-character LoRA, select only the triggers needed for the requested cast (and any documented global activation token), not every other character's trigger just because it appears in the catalog.

### LoRA weight guidance

- `1` is the normal starting strength.
- `0.6`–`0.8` is useful when the LoRA dominates the image or causes style bleed.
- `0.2`–`0.5` gives a subtle hint of a style or concept.
- Values above `1` may strengthen a weak effect but can introduce artifacts quickly.

When diagnosing LoRA strength, recommend changing one variable at a time and using a fixed seed when available.

## Multiple subjects and concept separation

**First resolve the cast against the multi-character LoRA catalog.** A suitable single adapter is the preferred default for multi-character scenes; the prompt-separation techniques below cannot isolate the effects of separately loaded LoRAs.

Default to **one ordinary comma-separated prompt**, even for two or more subjects. Give each character a clear identity and its own distinctive appearance, clothing, pose, and action. Put shared setting, interaction, and style details in the same prompt. Keep LoRA tokens and distinctive trigger words near the subject they describe for human readability, but understand that plain text ordering does not isolate their influence.

Example (without assuming parser extensions):

```text
/g 2 characters, fox, orange fur, green vest, wolf, grey fur, blue scarf, standing together, forest clearing, sunset, detailed background
```

Merely repeating a subject's name, moving a LoRA token, or separating tags with commas cannot reliably stop attribute bleed. For difficult multi-character scenes, the best remedy may be a backend-supported regional-conditioning, masking, inpainting, or compositing workflow. These are **not** features of the model itself.

### Conditional `BREAK` support

`BREAK` is an **AUTOMATIC1111-style prompt-parser directive**: it pads the current CLIP chunk and starts a new chunk. It does not create image regions, lock a LoRA to a character, or guarantee reduced concept bleed. Other backends can ignore or interpret it differently. ComfyUI, for example, lacks native `BREAK` parsing unless custom nodes add it.

**MakeFoxBot's own Advanced Prompt Tricks guide documents `BREAK`**, but successful parsing and effectiveness have not been independently confirmed in a live generation test. Do not emit `BREAK` in MakeFox commands by default. Only use it when the current backend is explicitly known and tested to implement the directive or the user specifically requests that syntax. Do not present it as a reliable solution to mixed-up subjects.

### Conditional regional prompting

`ADDCOMM`, `ADDCOL`, and `ADDROW` are syntax from third-party **Regional Prompter** extensions; they are not universal Stable Diffusion or LoRA commands. They only have spatial meaning when the backend implements that extension or compatible logic **and** region handling is configured. MakeFoxBot's own Advanced Prompt Tricks guide documents these operators; their live behavior and model-dependent limitations have not been independently verified.

**Don't use regional operators as a guaranteed fix for identity bleed.** If verified support is available for a particular backend, follow that backend's own syntax and settings. Example documented in MakeFoxBot's guide, subject to actual backend behavior:

```text
common scene, detailed background ADDCOMM fox, green vest ADDCOL wolf, blue scarf
```

Even with real regional conditioning, LoRA effects may still bleed across regions depending on how and where the weights are applied.

## Weights

Use weights to strengthen a missing detail or soften a dominant one:

```text
/g fox, male, (wizard hat:1.3), forest, (rain:0.7)
```

- `(tag:1.1)`–`(tag:1.4)` is a useful gentle-to-moderate boost.
- `(tag:0.7)`–`(tag:0.9)` softens a present detail.
- `(tag)` is approximately a small boost.
- `(several, tags:1.2)` weights the whole grouped phrase.
- Weight one problem at a time. Several competing high weights reduce control and invite artifacts.

Use weights only when a detail consistently fails to appear. For multi-subject bleed, do not prescribe `BREAK` or regional operators unless the backend has verified support; ordinary tag changes may not solve the problem.

## Wildcards

Use wildcards only when the user requests variation or supplies a known category. Preserve exact spelling and angle brackets. Unknown categories may print literally instead of rolling, so never invent one.

Common examples include `<species>`, `<pose>`, `<expression>`, `<outfit>`, `<background>`, `<theme>`, `<lighting>`, `<canine>`, `<dragon>`, `<pokemon>`, `<fur_color>`, and `<eye_color>`.

Wildcards can be combined with ordinary tags, weights, LoRAs, and regional sections.

## Quality control and troubleshooting

Before returning the prompt, check:

- tags follow the 5-stage anatomy order exactly: subject → looks & clothing → pose & action → setting → quality & style;
- tags are concise and comma-separated;
- filler and duplicate tags are removed;
- if negatives are provided, the positive and negative sides are not fighting each other;
- one coherent style direction remains;
- every supplied LoRA token still has both angle brackets;
- exact trigger words are present;
- LoRAs match the selected base-model family;
- when multiple named characters are requested, a compatible full-cast multi-LoRA was checked first; if selected, no redundant individual character LoRAs were stacked;
- each subject's identity and actions remain in its own group;
- advanced `BREAK`, `ADDCOMM`, `ADDCOL`, or `ADDROW` operators are used only when intentionally selected, with their limitations understood; spell them in uppercase;
- weighted syntax uses a colon, such as `(tag:1.2)`;
- the final result contains no placeholders or ellipses.

Useful diagnoses:

- extra limbs or fused subjects: reduce crowding, separate subjects, or add relevant anatomy negatives;
- oversaturated or deep-fried output: CFG may be too high;
- blurry or low-detail output: use specific detail tags, suitable steps, a detail-oriented model, or upscale a keeper;
- merged characters: check whether one compatible multi-character LoRA covers all requested identities before stacking separate character LoRAs; confirm trigger words and framing; if still merging, consider available regional conditioning, masking, or inpainting;
- weak LoRA: verify the exact token and trigger words before increasing weight;
- mushy LoRA output: lower its weight and confirm model-family compatibility;
- literal wildcard text: the category name is unsupported or misspelled.

Prompting is iterative. Prefer a few controlled rolls with small changes over one enormous “perfect” prompt.

## Required visible result

After any necessary one-sentence note, always end with one fenced `text` block containing the complete copy-ready positive prompt command. This is the entire deliverable — never an image, never a generation task:

```text
/g complete final positive prompt, including each intended trigger, literal LoRA token, and weight; include advanced operators only when supported
```

- Put the result in the visible answer, outside hidden reasoning or scratch work.
- Always include the complete `/g` line.
- Only include a `/setnegative` line when the user explicitly asks for negative prompts or supplies things to avoid.
- Do not return fragments, placeholders, ellipses, or “use the tags above.”
- If several variants are requested, keep shared tags stable and vary only the requested dimensions.
- If the user explicitly asks to send the prompt and an authorized messaging capability is available, send these exact commands unchanged to the established MakeFoxBot conversation and report the confirmed result. Never claim delivery without confirmation.
