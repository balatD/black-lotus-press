
---

**Installing on macOS:** the app is not signed with an Apple certificate, so macOS says it "is damaged" or that Apple "could not verify" it. It is neither. Drag it into Applications, then run this once in Terminal (and again after every update):

```
xattr -cr "/Applications/Black Lotus Press.app"
```

**Windows:** SmartScreen warns on the first start. Click *More info*, then *Run anyway*.

Documentation and FAQ: https://balatd.github.io/black-lotus-press/docs.html
