# One Question a Day

Every day there's one question, and everyone who opens the site that day gets the same one. You write for a few minutes, keep your answer, and send the question to a friend if it's a good one. Think Wordle, but you write instead of guessing letters.

Live at https://prathammukewar.github.io/one-question/

## How it works

There are 366 questions, one for each calendar date, February 29 included. A date asks the same thing every year, so when October 1 comes back around you'll see what you wrote last October 1. It only shows up after you've written this year's answer, so it can't steer you.

The writing box saves as you type. There's an optional five-minute timer that starts on your first keystroke and tells you when time's up, though you can keep going. Answering a day's question on that day (by your own clock) keeps your streak going.

The archive has a calendar of the days you wrote. You can read old answers, search them, or answer a question you missed. Late answers are marked late and don't count toward the streak.

For sharing, you can copy the question as an invite, copy a stat line like "One Question #41, 212 words, 6 day streak" that contains nothing you wrote, copy your answer as Markdown, or make a PNG card (1080 × 1350 for Instagram, or 1200 × 630) with the question and, if you want, your answer or a piece of it.

You can also export everything as Markdown or JSON, import a JSON export into another browser, and download an .ics file that puts a daily reminder in your calendar.

## Privacy

Answers are stored in your browser's localStorage and never sent anywhere. There's no account and no server. Clearing site data deletes them, so export a copy now and then.

Page view counting with GoatCounter is off by default. Set `GOATCOUNTER` in `js/config.js` to turn it on.

## Run it locally

It's plain HTML, CSS and JavaScript modules with no build step.

```
python3 -m http.server
```

Then open http://localhost:8000. The tests have no dependencies:

```
node test/test.mjs
```

## License

MIT. See [LICENSE](LICENSE).
