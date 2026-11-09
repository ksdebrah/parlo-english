# Parlo English

A small English-learning app for one learner. It's a static site: no server, no accounts, no AI.
It has lessons with audio, flashcards with spaced repetition, quizzes, read-aloud speaking checks
and practice questions. Progress is saved on the learner's phone.

## How it's organised

```
index.html            app page
css/style.css         styles
js/app.js             app logic
content/weeks.json    list of weekly content files  ← edit when you add a week
content/weeks/        one JSON file per week        ← add a new file each week
sw.js                 offline support
manifest.webmanifest  "Add to Home Screen" settings
icons/                app icons
```

## Adding a new week

1. Copy `content/weeks/week-02.json` to `content/weeks/week-03.json`.
2. Change `"week": 3`, the `title` and `intro`, and replace the content.
3. **Give every item a new, unique `id`** (e.g. `w3-l1`, `w3-c01`, `w3-s1`, `w3-q1`).
   Flashcard progress is saved by `id`, so never reuse or change an old one.
4. Add the file name to `content/weeks.json`:
   ```json
   { "weeks": ["week-01.json", "week-02.json", "week-03.json"] }
   ```
5. Commit and push. GitHub Pages updates within a minute or two.

The newest week is shown on the home screen. Its new flashcards join the daily review
automatically (10 new words a day by default; he can change this in Settings).

## Week file format

```jsonc
{
  "week": 3,
  "title": "…",
  "intro": "One sentence shown on the home screen.",
  "lessons": [{
    "id": "w3-l1", "level": "A2", "title": "…", "intro": "…",
    "phrases": [{ "en": "English phrase", "note": "Explanation", "tr": "optional translation" }],
    "tip": "optional",
    "dialogue": [{ "who": "Name", "line": "…" }]          // optional
  }],
  "cards": [{ "id": "w3-c01", "word": "…", "type": "noun", "meaning": "…", "example": "…", "tr": "optional" }],
  "quiz": [{ "q": "…", "options": ["a", "b", "c"], "answer": 1, "explain": "…" }],   // answer = index, starting at 0
  "speak": [{ "id": "w3-s1", "text": "Sentence to read aloud", "note": "optional" }],
  "questions": [{
    "id": "w3-q1", "context": "Small talk", "q": "Question",
    "tips": ["…"], "model": "Example answer", "useful": ["phrase", "phrase"]
  }]
}
```

Check your JSON before pushing (a missing comma breaks the week). Paste it into
<https://jsonlint.com> or run `python3 -m json.tool content/weeks/week-03.json`.

## Changing the app itself

Content updates need nothing extra. If you change `index.html`, `css/` or `js/`, also change
`VERSION` in `sw.js` (e.g. `parlo-v2`) so installed copies download the new files.

## Running it locally

The app loads JSON with `fetch`, so opening `index.html` directly from disk won't work. Run:

```
python3 -m http.server 8000
```

and open <http://localhost:8000>.

## Browser support

- Listening (text-to-speech): all modern phones and browsers.
- Speaking check (speech recognition): Chrome on Android and Chrome or Edge on a computer.
  On iPhone the app shows a "listen and repeat" mode instead.
