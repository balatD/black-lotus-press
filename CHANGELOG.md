# Changelog

## Unreleased

- Lorcana and One Piece: home printer orders take Lorcana deck lists, as Dreamborn and Inkdecks export them, with the cards from Lorcast, and One Piece deck lists, as OPTCGSim and Limitless export them, with the cards from optcgapi.com. The card editor shows the other printings and artworks.
- Other cards: a home printer order of *Other cards* prints your own images, one card each, in a size of its own: standard, Japanese, tarot, mini, square, jumbo, business card and more, or any size from 20 mm to 190 × 260 mm.
- Print at home on both sides: *Sides* adds a page of backs after every page of fronts, laid out for turning the paper over on the long or short edge, with an offset of its own for the backs.
- Print and cut with a Silhouette Cameo or Portrait: the pages get the registration marks of Silhouette Studio, and *Save cut file* saves the cut lines of the cards as a DXF or SVG.
- *Darken edges* on the *Print* tab darkens the bleed and border of every card, so black borders print deep black.
- The card editor upscales a single card on request and shows the result next to the Scryfall scan.
- Magic cards in other languages: *Card language* on the *Setup* tab switches every card of the order to its printing in German, French, Italian, Spanish, Portuguese, Japanese, Korean, Russian or Chinese, where Scryfall has it, and decks then import and update in it. The *Printings* tab of the card editor lists the printings of any language.
- Print at home: the guides come in the colour, width and style you choose, magenta, cyan, black or grey, 0.25 to 2 pt, solid, dashed or dotted, and the crop marks in the length and at the distance from the cards you choose. Orders saved before keep their guides as they were.
- Print at home: new page guides run from the paper edges to the cuts of the outer cards, or as *Cut lines outside the cards* through the margins and the space between the cards but never over a card.
- Print at home: *Card guides* mark the cut of every card, at its corners or all around it, with square corners or round ones like the card's, outside the cut in the bleed, on it or inside it.

## 2.7.0

notmpc.eu is gone, as the shop closed; its orders carry on at printerstudio.de.

- notmpc.eu is gone, as the shop closed: the app, the command-line tool, the website and the documentation no longer offer it. Orders made for it carry on at printerstudio.de, which prints the same decks of 18 to 612 cards; *Process images* makes their images once more in its size.

## 2.6.0

A guided first order, a default shop, single cards from Scryfall, and processing profiles that are easier to handle.

- Single cards from Scryfall: *Add a card…* on the *Cards* tab searches Scryfall for any card by name and adds it to the order, also to one without decks. Its card editor opens right away, to pick the printing and the MPC Autofill image.
- Processing profiles are easier to handle: a profile can be renamed, and its orders stay on it; *Copy profile* asks for the name of the copy. After saving, a profile lists the orders that still use its older settings and updates them in one click. An order's *Setup* tab shows its profile's resolution, upscaling and copyright line, with *Edit profile* to open it and a way back. Unsaved changes of a profile are no longer dropped without asking when you switch to another profile or leave the screen.
- An order guides you through its steps: the tabs *Setup*, *Cards* and *Print* are numbered and ticked once done, and a bar at the bottom of *Setup* and *Cards* names what comes next and leads there. The *Cards* and *Print* tabs of an order without cards lead back to *Setup*, and a shop without orders offers to create the first one.
- A guide for the first order: on a first start without orders, a card in the order list takes you through creating the order, adding the deck, checking the cards and printing, and highlights the control to use next. *Turn off the guide* hides it; *Show the guide* at the bottom of the list brings it back.
- A default shop: tick *Always start with the shop I pick* when choosing the shop, and the app starts with it instead of asking. *Switch print shop* changes it or, unticked, asks on every start again.
- *Add and import* imports a deck as soon as it is added, with the boards ticked below its link, so no second click on *Import* is needed. The decks now come first on the *Setup* tab, before the card back and the profile.

## 2.5.0

Yu-Gi-Oh and Pokémon cards printed at home, from pasted deck lists.

- Yu-Gi-Oh and Pokémon cards print at home: a new order for the *Home printer* asks for the card game. Its decks are pasted lists: a .ydk file or ydke:// link for Yu-Gi-Oh, the export of Pokémon TCG Live or Limitless for Pokémon. The cards come from YGOPRODeck and TCGdex, Pokémon cards in English, German, French, Italian or Spanish, are upscaled like the Magic scans and print at their own size, 59 × 86 mm for Yu-Gi-Oh. The card editor offers the other artworks of a Yu-Gi-Oh card and the other printings of a Pokémon card. Cards TCGdex has no image of, like the basic energies, print as another card of the same name, and the import says which.
- Home printing no longer processes the card back, which it does not print.

## 2.4.2

Home printing from the finest images, and cut guides that show on dark cards.

- The crop marks and cut lines of home printing are magenta instead of grey and twice as wide, so they show on black-bordered and dark cards too.
- Home printing uses the finest images: every card in its own resolution, at least that of the profile, so MPC Autofill images keep their up to 1200 dpi, as JPEGs of the highest quality with the colours at full resolution. PDFs get several times larger, a Commander deck about half a gigabyte. Orders printed at home before make their images once more with *Process images*.

## 2.4.1

Cards printed at home can be moved on the page, for printers that pull the paper in early or late.

- Home printing can move the cards on the page, down or up and right or left in millimetres, for printers that pull the paper in early or late and cut off a row of cards. The preview, *Print…* and *Save PDF* all follow it, and the cards always stay on the paper.

## 2.4.0

Cards printed at home on A4 or Letter pages, Archidekt decks imported like Moxfield decks, and meinspiel.de orders uploaded as a lossless image per card side instead of PDFs.

- Print at home: the new *Home printer* shop takes an order through the same steps as the others and ends with *Print…*, which lays the card fronts out on A4 or Letter pages and opens the system's print dialog, or *Save PDF*, which saves the same pages as a PDF and opens it. The Print tab sets the cards per page (as many as fit the paper, also landscape), the copies, all cards or only the tokens or one deck, the space between the cards, the bleed and crop marks or cut lines, with a live preview of every page. Both sides of a double-faced card print as cards of their own, next to each other on one page. Empty slots on the last page are offered to the order's tokens, on the Cards tab and the Print tab, so no paper goes to waste.
- Archidekt decks can be added to an order like Moxfield decks, by their link, and updated the same way. Archidekt has categories instead of boards: the commander and companion always come along, a card in the *Sideboard* category goes to the sideboard, one in a category left out of the deck, such as the maybeboard, to *Considering*, and the rest to the main board, each card by its first category. The tokens are the ones Scryfall knows the cards make, as for Moxfield decks. No browser window opens for Archidekt.
- meinspiel.de gets a lossless PNG of every card side in its own resolution, at least that of the profile, instead of two PDFs per pack, so the 200 MB limit for the PDFs of a pack is gone and orders at 1200 dpi print as well. Every image goes up once; meinspiel.de copies it to the other cards that show it, such as the card back. *Process images and upload* goes from the cards to the games in one click.
- While the app uploads to meinspiel.de, its window is covered, with the progress in the middle, so no click on meinspiel.de's page gets in the way. Closing the window asks first, as that stops the upload.
- The resolution of the profile is the least a card gets. MPC Autofill images are no longer scaled down to it, and MPC Autofill images and card backs below it are upscaled like the scans. Orders processed before download their MPC Autofill images once more; the upscaled scans stay.
- The print images of meinspiel.de orders are sRGB like those of the other shops; meinspiel.de turns them into its printer's colours itself. Orders processed before keep their CMYK print images until they are made again, which makes no difference to the upload: its images are made from the processed scans.

## 2.3.0

Orders shared with friends as a file, with or without their processed images, and the actions of an order gathered in one menu.

- Share an order: *Export* in the *⋯* menu at the top of an order saves it as a file, with the downloaded and upscaled images or only the order, and *Import order* below the order list adds it in another Black Lotus Press with the same processing settings.
- Processing an order that upscales without Upscayl installed says so, instead of failing with an unclear error.
- *Move or copy*, *Export*, *Rename* and *Delete order* are in the *⋯* menu at the top of an order, so the top of the order stays tidy, also in a narrow window.

## 2.2.0

Blank slots filled with tokens, uploads to meinspiel.de that close the browser by themselves and carry on after a pack that failed, and a set of smaller conveniences: filters, renaming, keyboard shortcuts, notifications and a faster import.

- Blank slots in the last meinspiel.de pack can be filled with tokens. The Cards tab says how many slots stay blank and offers another copy of each token of the order with one click, or any token from Scryfall by name with *Find a token…*. A token added this way belongs to no deck, so updating the decks from Moxfield keeps it.
- *Fill all blank slots* on the Cards tab shares the blank slots of the last meinspiel.de pack out over the order's tokens in one click.
- A token added with *Find a token…* can be removed again: *Remove from the order* in its card editor. Cards from a deck are switched off instead, since the next update from Moxfield would bring them back.
- After the upload to meinspiel.de, the browser closes by itself: the games are saved in your account already. The app lists them with links that open in your usual browser, where you choose the box and order. Only a game meinspiel.de did not save keeps the browser open, so you can save it there.
- When an upload to meinspiel.de stops at a pack, the games made until then are kept, and *Continue with pack …* uploads only the rest, as long as the cards print the same. *Upload all again* starts over.
- For meinspiel.de, one click processes the missing card images and builds the PDFs: *Process images and build PDFs*.
- The Cards tab shows only the low-res cards, the cards not on Scryfall, those with an MPC Autofill image, the tokens or the switched-off cards at a click, also together with the name search. The card editor steps through the cards shown when it opened.
- Card images that fail to process are outlined on the press sheet, with the reason in the tooltip and the large view, and *Retry the failed images* processes only those again.
- Rename an order: *Rename* at the top of the order. Its images, PDFs and the links to its meinspiel.de games come along.
- The order list has a field that finds an order by name.
- Keyboard shortcuts, with Ctrl instead of Cmd on Windows and Linux: Cmd+1, 2 and 3 switch between the tabs of an order, Cmd+F finds a card, Cmd+N starts a new order.
- A task that ends while the app is in the background, such as processing the images or an upload, says so in a notification of your system; clicking it brings the app back.
- Importing a deck asks Scryfall for 75 cards at a time instead of one by one, which makes the lookup much faster for large decks.
- A damaged order or profile file no longer empties the list: the app shows all the others, names the file it could not read and leaves it as it is.
- An edit made just before quitting the app is saved; the app waits for it before it quits.

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
