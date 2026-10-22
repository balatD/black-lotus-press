# Changelog

## Unreleased

- After the upload to meinspiel.de, the browser closes by itself: the games are saved in your account already. The app lists them with links that open in your usual browser, where you choose the box and order. Only a game meinspiel.de did not save keeps the browser open, so you can save it there.
- Blank slots in the last meinspiel.de pack can be filled with tokens. The Cards tab says how many slots stay blank and offers another copy of each token of the order with one click, or any token from Scryfall by name with *Find a token…*. A token added this way belongs to no deck, so updating the decks from Moxfield keeps it.

## 2.1.0

printerstudio.de as a third print shop, the shops in a window that looks like part of the app, and orders that move between shops. notmpc.eu is not available at the moment.

- meinspiel.de and printerstudio.de open in a browser window without tabs and address bar, exactly where the app's window is, so the shop reads as part of the app. A bar from Black Lotus Press sits over the shop's pages, with a panel that lists every step of the hand-over with what it is doing, a progress bar for the uploads, what is done and what is left to you; the panel folds away with *Hide*. While you need to log in, it darkens the page around the login form and points at it. In front of the Print tab, the app shows the same steps, with *Show the browser window* and *Cancel*, and afterwards what was done.
- The upload to meinspiel.de shows what really happens: logging in, and for every pack creating the game, uploading its PDFs megabyte by megabyte, meinspiel.de's own processing status, and whether the game is saved in your account. The progress counts these steps instead of the packs, so it no longer sits at 0 while you log in and the PDFs go up.
- Logging in at meinspiel.de takes one try instead of two. meinspiel.de renews a new visitor's session on the first page loads and lost a login made before that; the app now lets the session settle before it shows you the login form.
- "Use the sharpest MPC Autofill images" no longer fails on decks with basic lands. Their many printings took so many Scryfall searches in a row that Scryfall turned the app away; the app now stays below Scryfall's limit and, when it is turned away all the same, waits the half minute Scryfall asks for and carries on. The same goes for importing decks.
- Print at [printerstudio.de](https://www.printerstudio.de/machen/blanko-spielkarten-63x88mm-personalisieren.html) as well, a third print shop to choose after the splash screen. For printerstudio.de the app makes RGB images of 816 × 1110 pixels at 300 dpi, the size their designer asks for, in decks of 18 up to 612 cards. First you log in or sign up at printerstudio.de in the browser window. Then the app opens their designer for 63 × 88 mm cards on Standard (glatt) stock, one window per deck, uploads the images one at a time and puts every card in its slot, with one back for the whole deck unless a card has a back of its own. Every deck is saved as a project in your account, named after the order and the date. Each window stops at the preview, where you confirm the copyright and put the deck into the cart.
- notmpc.eu is not available at the moment, because sending orders to it does not work. It cannot be chosen after the splash screen nor as the shop to move or copy an order to; its orders are kept and come back when it is available again.
- Move an order to another print shop, or copy it there under a new name: *Move or copy* next to *Delete order*. The decks, cards, the images you picked and your edits come along. A moved order keeps its name and makes its images anew in the new shop's format, which only takes seconds; a copy brings the downloaded and upscaled images along, so nothing is upscaled again. Afterwards the app switches to the shop of the order and opens it.
- Choose the card back from all card backs of MPC Autofill: *Choose from MPC Autofill* on the Setup tab shows them with their creator and resolution, and finds them by name or creator. Pasting a card back's ID still works.
- Save an order as an MPC Autofill XML: *Save MPC Autofill XML* on the Print tab, for every shop. MPC Autofill images and the card back are in it by their ID, the other cards as their processed images on this computer, so MPC Autofill's desktop tool can order the whole deck at MakePlayingCards or PrinterStudio. MPC Autofill's editor on mpcfill.com imports it as well and picks images of its own for the cards from this computer.

## 2.0.0

A second print shop and a new way to choose each card's image. Orders from earlier versions belong to meinspiel.de and stay as they are.

- Print at [notmpc.eu](https://notmpc.eu/de/) as well. After the splash screen you choose the print shop, and every order belongs to the shop it was made for. For notmpc.eu the app makes RGB images in decks of up to 612 cards, uploads them and opens their designer with every card in its slot, one tab per deck; you choose the options and order there without an account.
- A card editor takes the place of the card's details and the printing dialog. Click a card to see its image large, with the printings, the MPC Autofill images and your own image on the right. Pick one and compare it side by side with the Scryfall scan, zoomed in to the pixel; MPC Autofill images load in full resolution for this. Then click *Use this*. Arrow keys pick an image, Enter uses it, C compares, and Page Up and Page Down go to the previous or next card, so a whole deck goes by without closing the editor. A slider sets the size of the images to choose from.
- Swap a card's Scryfall scan for an image from [MPC Autofill](https://mpcfill.com) in the card editor, usually at 800 to 1200 dpi, for both shops. The app compares every MPC Autofill image of the card with the Scryfall scans of all printings, shows the ones that match the card's printing first and keeps custom art, altered art and own frames apart.
- "Use the sharpest MPC Autofill images" on the Cards tab does this for the whole order: every card gets the MPC Autofill image of the highest resolution that shows its printing. Cards with an image you picked keep it. Afterwards a list shows the cards MPC Autofill has no image of the printing for; pick an image of another printing for each, and the card takes that printing. The list stays at hand on the Cards tab.

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
