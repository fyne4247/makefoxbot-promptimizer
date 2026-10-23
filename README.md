# MakeFox Prompt Formatter

Turn rough image ideas into clean, copy-ready MakeFoxBot `/g` commands.

You say something like *"a fox wizard casting a spell in a forest at night"* and get back:

```text
/g fox, male, wizard hat, sitting, casting spell, forest, night, moonlight, detailed background
```

It's a skill for AI assistants (built for OpenClaw), plus a few small command-line tools it uses to check tag spelling and find the right LoRAs. It **only writes prompts**. It never generates images itself.

> This is a community project. It isn't made by or affiliated with MakeFoxBot.

## What it does

- **Turns plain English into tags.** It drops filler like "a picture of" or "really" and orders tags the way MakeFox's Prompting 101 guide recommends: subject → looks & clothing → pose & action → setting → quality & style.
- **Uses real e621 tag names.** It checks tags against the e621 tag list, fixes spelling and outdated aliases (`boobs` → `breasts`), and formats them the way MakeFox expects (spaces instead of underscores, escaped parentheses).
- **Finds LoRAs for named characters.** It looks up the exact `<lora:...>` token and trigger words, and won't mix a LoRA with the wrong model family (for example, an Illustrious LoRA on a Pony model).
- **Prefers one shared LoRA for multi-character scenes.** If one LoRA covers your whole cast (for example a Lion King LoRA for Simba and Scar), it uses that instead of stacking several separate ones, which tends to blend the characters together.
- **Handles model quirks.** Pony score tags, Lightning step/CFG hints, keeping "no X" out of the positive prompt, and so on.

## Requirements

- **Node.js** 18 or newer (for the lookup tools; no npm install needed)
- **Python 3** (only for refreshing the e621 tag list)

## Install

Clone or copy this folder into your OpenClaw skills directory:

```bash
git clone https://github.com/fyne4247/makefoxbot-promptimizer.git ~/.openclaw/skills/make
```

Then ask your assistant for a MakeFox prompt, or invoke the skill as `/make`.

## Setup

### 1. Refresh the tag list (recommended)

A tag list is included, but it's an older snapshot. Pull the latest one from e621's public database exports:

```bash
python3 scripts/update-e621.py
```

This downloads only the tag, alias, and implication lists (no posts or images), verifies the checksums, and swaps the files in only if everything checks out. Set `E621_USER_AGENT` to something that identifies you, ideally with a contact URL.

Already have the export files downloaded?

```bash
python3 scripts/update-e621.py --source-dir /path/to/archives/
```

### 2. Get a LoRA catalog

**The LoRA catalog isn't included in this repo.** Without one, the skill still writes prompts, but it can't suggest LoRAs. There are two ways to get one.

**Option A: import an export you already have**

```bash
node scripts/import-loras.js path/to/export.json --out references/loras.json
```

**Option B: collect the public MakeFox catalog yourself** (experimental)

```bash
npm install --no-save playwright
node scripts/scrape-makefox.js --chrome --headed --out makefox-loras.json
```

No Chrome? Run `npx playwright install chromium` first, then drop `--chrome`.

The collector reads the public model explorer page by page. It doesn't log in or touch any account data. Add `--delay-ms 1000` to go easy on the site. When it finishes, check `makefox-scrape-report.json`. An exit code of `2` means the results are partial. Once you're happy with the results, copy the file into place:

```bash
cp makefox-loras.json references/loras.json
```

## Using the tools directly

The skill runs these for you, but you can use them yourself too.

**Look up tags:**

```bash
node scripts/lookup-tag.js "blue fur" "couch"
node scripts/lookup-tag.js --explain "scar"   # shows category, popularity, implied tags
```

**Find LoRAs:**

```bash
node scripts/lookup-lora.js --model Illustrious "Scar"
node scripts/lookup-lora.js --model Illustrious "Simba" "Scar"   # checks for one LoRA covering both
node scripts/lookup-lora.js --limit 10 "Simba"                    # all model families
```

Pass each character as its own argument. If one LoRA covers everyone, it shows up under `multi_character.recommended`.

## Good to know

- **Tags aren't guaranteed to work.** A real e621 tag isn't automatically something every model learned. Treat lookups as a spelling and existence check.
- **Your LoRA catalog may be incomplete.** If a character doesn't show up, that doesn't mean MakeFox doesn't have a LoRA for them.
- **`BREAK` and regional prompting (`ADDCOMM`, `ADDCOL`, `ADDROW`)** are documented by MakeFox, but the skill doesn't use them unless you ask, since how well they work depends on the backend.
- **Negative prompts:** the skill only writes a `/setnegative` line if you ask for negatives or tell it what to avoid.

## Running the tests

```bash
npm test
```

Some tests need `references/loras.json`, so set up a catalog first.

## Data and licensing

The tag data comes from e621's public database exports. LoRA names and trigger words belong to their creators. If you publish data you've collected, check the sources' terms first. This repo's license covers the code, not third-party data.
