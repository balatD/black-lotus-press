# Changelog

## 1.1.0

- The app looks for a new version when it starts. Installed with the Windows setup or as a Linux AppImage, it downloads the update and installs it when you restart or quit. On a Mac and with the portable Windows ZIP, the sidebar shows the new version with a link to the download. Version 1.0.0 cannot do this yet, so download 1.1.0 by hand once.
- A new app icon: the card printer with the Black Lotus Press card coming out of it.
- The download is about a fifth smaller. Chromium's own menus and dialogs now come in English and German only.
- The splash screen is an animated card printer: card 55 runs under the print head once per ribbon panel (yellow, magenta, cyan, black, overlay), lands on the stack, turns to face you and is sealed in a graded slab: GEM MT 10.

## 1.0.0

The first public release: a desktop app for macOS (Apple Silicon), Windows and Linux, plus the command-line edition.

**Decks**
- Import any number of Moxfield decks into one order, each with the boards you choose.
- The exact printings from Moxfield, looked up on Scryfall. A dialog after the import offers non-foil printings for the deck's foils.
- Update a deck from Moxfield without losing your edits.

**Cards**
- The order as a list or a zoomable grid, with packs, blank slots, left-out tokens, the price and the cards' Cardmarket value.
- Switch cards off, change quantities, drag them into the print order.
- Pick any printing on Scryfall, with prices and filters, also for single copies of a card.
- Your own images for fronts and backs, with or without bleed.
- Brightness and contrast for the order and for single cards.

**Print**
- Every pack as a press sheet of 55 cards, fronts and backs.
- Processing in the background with progress, cancelling, and GPU load and temperature while upscaling.
- Process a single card or the whole order again.
- Two PDFs per pack in meinspiel.de's format, checked against the 200 MB upload limit.
- Upload to your meinspiel.de account; you log in yourself, and the app keeps the links to the games.

**Images**
- Corners filled, borders cropped, holo stamps removed, 3 mm bleed; borderless art is mirrored into the bleed.
- The copyright line kept, blurred, replaced by "Proxy – not for sale" or by your own text.
- Upscaling to 600 dpi with Upscayl, installed from the app, with seven models.
- CMYK with meinspiel.de's ISO Coated v2 300 % profile, 10 % brighter for print.
