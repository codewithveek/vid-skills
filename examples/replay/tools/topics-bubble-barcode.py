import os
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mk.py")).read())

# ---------- Bubble wrap ----------
BW = "https://en.wikipedia.org/wiki/Bubble_wrap"; BWT = "Bubble wrap - Wikipedia"
out("bubble-wrap-wallpaper.json", {
"ResearchDossier": doss("Bubble wrap was meant to be wallpaper", "In 1957 Alfred Fielding and Marc Chavannes were attempting to create a three-dimensional plastic wallpaper. The idea failed, but they found it could be used as packing material. Fielding co-founded Sealed Air in 1960. One of the first widespread uses came in 1960, shipping IBM 1401 computers to customers who had never seen this packing material. Bubble Wrap Appreciation Day is the last Monday of January, and in 2015 Sealed Air launched iBubble Wrap, which cannot be popped.", "The failed wallpaper that ships the world.", [
  C("c1", "In 1957, Alfred Fielding and Marc Chavannes were attempting to create a three-dimensional plastic wallpaper.", [S(BW, BWT, "were attempting to create a three-dimensional plastic wallpaper.")]),
  C("c2", "The wallpaper idea was a failure, but they found what they made could be used as packing material.", [S(BW, BWT, "Although the idea was a failure, they found that what they made could be used as packing material.")]),
  C("c3", "Sealed Air was co-founded by Fielding in 1960.", [S(BW, BWT, "Sealed Air was co-founded by Fielding in 1960.")]),
  C("c4", "One of the first widespread uses of bubble wrap came in 1960, shipping the new IBM 1401 computers to customers, most of whom had never seen this packing material.", [S(BW, BWT, "with the shipping of the new IBM 1401 computers to customers")]),
  C("c5", "Bubble Wrap Appreciation Day is celebrated on the last Monday of January.", [S(BW, BWT, "Bubble Wrap Appreciation Day is celebrated on the last Monday of January.")]),
  C("c6", "In 2015 Sealed Air launched iBubble Wrap, whose connected bubbles cannot be popped.", [S(BW, BWT, "In 2015 Sealed Air launched an")])]),
"Script": {"headline": "Bubble Wrap Was Meant to Be Wallpaper", "cta": "Follow for more things hiding in plain sight.", "beats": [
  B("b1", "hook", [L("l1", "Bubble wrap was supposed to go on your walls.", ["walls."], ["c1"], 0.35)]),
  B("b2", "history", [L("l2", "In 1957, two inventors, Alfred Fielding and Marc Chavannes, were trying to make three-dimensional plastic wallpaper.", ["wallpaper."], ["c1"], 0.3),
                      L("l3", "As wallpaper, it was a failure.", ["failure."], ["c2"], 0.3),
                      L("l4", "But they realised it could protect things in a box.", ["protect"], ["c2"], 0.35)]),
  B("b3", "proof", [L("l5", "In 1960, Fielding co-founded Sealed Air to sell it.", ["Sealed"], ["c3"], 0.3),
                    L("l6", "One of its first big jobs was shipping IBM 1401 computers, to customers who had never seen packing like it.", ["never"], ["c4"], 0.4)]),
  B("b4", "twist", [L("l7", "Today it has its own holiday, Bubble Wrap Appreciation Day, on the last Monday of January.", ["holiday,"], ["c5"], 0.3),
                    L("l8", "And in 2015, the same company made a version you can't even pop.", ["can't"], ["c6"], 0.4)], "drop"),
  CTAB]},
"Storyboard": {"shots": [
  sh("sh1", "l1", pxb(6159688, "close-up of bubble wrap", focusY=0.5)),
  sh("sh2", "l1", pxb(33419833, "vintage patterned wallpaper"), "walls."),
  sh("sh3", "l2", tw("wallpaper, invented:", "1957", 10)),
  sh("sh4", "l2", pxb(36539003, "black and white bubble wrap texture", "3D plastic wallpaper"), "three-dimensional"),
  sh("sh5", "l3", icon("x", "FAILED WALLPAPER", "#FF3B30")),
  sh("sh6", "l4", icon("package", "PACKING MATERIAL", "#FFD400")),
  sh("sh7", "l5", tw("Sealed Air, founded:", "1960", 10)),
  sh("sh8", "l6", broll("IBM 1401 Demo Lab, Computer History Museum", "an IBM 1401 computer", "IBM 1401")),
  sh("sh8b", "l6", icon("package-open", "NEVER SEEN BEFORE", "#20FFF6"), "customers"),
  sh("sh9", "l7", icon("calendar", "LAST MONDAY OF JANUARY", "#FFD400")),
  sh("sh10", "l8", tw("unpoppable bubble wrap:", "2015", 10)),
  *CTA(11)]},
"PublishCopy": copy("Bubble wrap was supposed to be wallpaper",
 "Bubble wrap was supposed to go on your walls.\nIn 1957, Alfred Fielding and Marc Chavannes were trying to make three-dimensional plastic wallpaper. It failed, but it turned out to be great packing material. One of its first big jobs was shipping IBM's 1401 computers in 1960. Today it has its own day, and in 2015 Sealed Air made a version you can't pop.",
 ["bubblewrap", "inventions", "history", "satisfying", "didyouknow"], ["bubble wrap history", "bubble wrap was wallpaper", "who invented bubble wrap", "Sealed Air", "Bubble Wrap Appreciation Day"],
 "Bubble wrap was supposed to go on your walls.", "Motion-graphics explainer on how bubble wrap started as failed wallpaper.",
 "Do you pop bubble wrap one bubble at a time, or twist the whole sheet? 🫧", [{"url": BW, "title": "Bubble wrap"}]),
"Review": REV})

# ---------- Barcode ----------
BC = "https://en.wikipedia.org/wiki/Barcode"; BCT = "Barcode - Wikipedia"
out("barcode-sand.json", {
"ResearchDossier": doss("The barcode started as a drawing in the sand", "Norman Joseph Woodland formed his first barcode from sand on a beach in Florida, extending Morse code's dots and dashes downwards into narrow and wide lines. He and Bernard Silver filed a patent on 20 October 1949, issued 7 October 1952. On 26 June 1974, a 10-pack of Wrigley's Juicy Fruit gum was scanned at Marsh's Supermarket in Troy, Ohio, the first commercial use of the UPC.", "From Morse code in the sand to every checkout.", [
  C("c1", "Woodland formed his first barcode from sand on the beach, while living in Florida.", [S(BC, BCT, "he formed his first barcode from sand on the beach.")]),
  C("c2", "He extended Morse code's dots and dashes downwards into narrow and wide lines.", [S(BC, BCT, "I just extended the dots and dashes downwards and made narrow lines and wide lines out of them.")]),
  C("c3", "The barcode was invented by Norman Joseph Woodland and Bernard Silver and patented in the US in 1952.", [S(BC, BCT, "The barcode was invented by Norman Joseph Woodland and Bernard Silver and patented in the US in 1952.")]),
  C("c4", "On 26 June 1974, a 10-pack of Wrigley's Juicy Fruit gum was scanned, the first commercial use of the UPC, at Marsh's Supermarket in Troy, Ohio.", [S(BC, BCT, "On 26 June 1974, a 10-pack of Wrigley's Juicy Fruit gum was scanned, registering the first commercial use of the UPC.")])]),
"Script": {"headline": "The Barcode Began in the Sand", "cta": "Follow for more things hiding in plain sight.", "beats": [
  B("b1", "hook", [L("l1", "The barcode started as a drawing in the sand.", ["sand."], ["c1"], 0.35)]),
  B("b2", "history", [L("l2", "Inventor Joseph Woodland was on a beach in Florida, trying to turn Morse code into something a machine could read.", ["Morse"], ["c1", "c2"], 0.3),
                      L("l3", "So he drew Morse code's dots and dashes in the sand, and stretched them downwards.", ["downwards."], ["c2"], 0.3),
                      L("l4", "Short marks became thin lines. Long marks became thick ones.", ["thick"], ["c2"], 0.4)]),
  B("b3", "proof", [L("l5", "He and Bernard Silver patented the idea in 1952.", ["1952."], ["c3"], 0.3),
                    L("l6", "But it took another twenty-two years to scan a real product in a shop.", ["twenty-two"], ["c3", "c4"], 0.4)]),
  B("b4", "twist", [L("l7", "On June 26, 1974, in a supermarket in Troy, Ohio, the very first item went over the scanner.", ["first"], ["c4"], 0.3),
                    L("l8", "A ten-pack of Juicy Fruit chewing gum.", ["Juicy"], ["c4"], 0.4)], "drop"),
  CTAB]},
"Storyboard": {"shots": [
  sh("sh1", "l1", pxb(29252745, "ripples in beach sand", focusY=0.5)),
  sh("sh2", "l1", icon("barcode", "DRAWN IN THE SAND", "#FFD400"), "drawing"),
  sh("sh3", "l2", pxb(31785182, "rippled sand on a beach", "Florida beach")),
  sh("sh4", "l2", tw("the idea:", "· — · ·  —", 8), "Morse"),
  sh("sh5", "l3", icon("move-down", "DOTS AND DASHES, STRETCHED", "#20FFF6")),
  sh("sh6", "l4", versus({"icon": "minus", "title": "DOT", "label": "Thin line"}, {"icon": "equal", "title": "DASH", "label": "Thick line"}, "none")),
  sh("sh7", "l5", tw("barcode patent:", "1952", 10)),
  sh("sh8", "l6", stat("22 yrs", "from patent to the first scan in a shop", "c4")),
  sh("sh9", "l7", pxb(34708254, "a barcode scanner on a desk", "The scanner")),
  sh("sh9b", "l7", tw("Troy, Ohio:", "June 26, 1974", 12), "June"),
  sh("sh10", "l8", broll("Juicy Fruit 1946", "a vintage pack of Juicy Fruit gum", "Wrigley's Juicy Fruit")),
  *CTA(11)]},
"PublishCopy": copy("The barcode started as a drawing in the sand",
 "The barcode started as a drawing in the sand.\nOn a Florida beach, Joseph Woodland stretched Morse code's dots and dashes downwards into thin and thick lines. He and Bernard Silver patented it in 1952. But the first real scan didn't happen until June 26, 1974, in Troy, Ohio: a ten-pack of Juicy Fruit gum.",
 ["barcode", "inventions", "history", "supermarket", "didyouknow"], ["barcode history", "who invented the barcode", "first barcode scan", "Juicy Fruit barcode", "Morse code barcode"],
 "The barcode started as a drawing in the sand.", "Motion-graphics explainer on how the barcode grew from Morse code drawn in sand.",
 "Self-checkout or a real cashier? 🛒 Pick one, and say why.", [{"url": BC, "title": "Barcode"}]),
"Review": REV})
