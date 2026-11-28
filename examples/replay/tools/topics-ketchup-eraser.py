import os
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mk.py")).read())

# ---------- Ketchup ----------
KE = "https://en.wikipedia.org/wiki/Ketchup"; KET = "Ketchup - Wikipedia"
out("ketchup-no-tomatoes.json", {
"ResearchDossier": doss("The first ketchup had no tomatoes", "The etymology of ketchup is unclear; one theory derives it from Hokkien kôe-chiap or kê-chiap, the brine of pickled fish or shellfish. From the 1600s ketchup was prepared with mushrooms as a primary ingredient; early recipes contained mushrooms, oysters, mussels, egg whites, grapes or walnuts. James Mease published the first known tomato ketchup recipe in 1812.", "A sauce that changed its main ingredient but kept its name.", [
  C("c1", "One theory derives ketchup from Hokkien kôe-chiap or kê-chiap, meaning the brine of pickled fish or shellfish; the etymology is unclear.", [S(KE, KET, "where it meant the brine of pickled fish or shellfish")], "medium"),
  C("c2", "From the 1600s ketchup was prepared with mushrooms as a primary ingredient, rather than tomatoes.", [S(KE, KET, "from the 1600s ketchup was prepared with mushrooms as a primary ingredient, rather than tomatoes")]),
  C("c3", "Early recipes contained mushrooms, oysters, mussels, egg whites, grapes, or walnuts.", [S(KE, KET, "mushrooms, oysters, mussels, egg whites, grapes, or walnuts")]),
  C("c4", "James Mease published the first known tomato ketchup recipe in 1812.", [S(KE, KET, "James Mease published the first known tomato ketchup recipe in 1812.")])]),
"Script": {"headline": "The First Ketchup Had No Tomatoes", "cta": "Follow for more things hiding in plain sight.", "beats": [
  B("b1", "hook", [L("l1", "The first ketchup didn't have a single tomato in it.", ["tomato"], ["c2"], 0.35)]),
  B("b2", "history", [L("l2", "The word may come from Hokkien Chinese, where it meant the brine of pickled fish.", ["fish."], ["c1"], 0.3),
                      L("l3", "And from the 1600s, ketchup was made mostly from mushrooms.", ["mushrooms."], ["c2"], 0.3),
                      L("l4", "Other recipes used oysters, mussels, grapes, even walnuts.", ["walnuts."], ["c3"], 0.4)]),
  B("b3", "proof", [L("l5", "The first known tomato ketchup recipe didn't show up until 1812.", ["1812."], ["c4"], 0.3),
                    L("l6", "It was published by a man named James Mease.", ["Mease."], ["c4"], 0.4)]),
  B("b4", "twist", [L("l7", "So the name on your bottle is older than the tomatoes inside it.", ["older"], ["c2", "c4"], 0.4)], "drop"),
  CTAB]},
"Storyboard": {"shots": [
  sh("sh1", "l1", pxb(4676397, "ketchup squeezed onto fries", focusY=0.5)),
  sh("sh2", "l1", tw("tomatoes in the first ketchup:", "0", 10), "single"),
  sh("sh3", "l2", tw("Hokkien, maybe:", "kê-chiap", 10)),
  sh("sh4", "l2", icon("fish", "BRINE OF PICKLED FISH", "#20FFF6"), "brine"),
  sh("sh5", "l3", pxb(17630122, "a cluster of wild mushrooms", "Mushroom ketchup")),
  sh("sh6", "l4", pxb(17205217, "fresh oysters on ice")),
  sh("sh6b", "l4", pxb(39432877, "walnuts in their shells"), "even"),
  sh("sh7", "l5", tw("first tomato ketchup recipe:", "1812", 10)),
  sh("sh8", "l5", pxb(29479888, "a pile of ripe red tomatoes"), "recipe"),
  sh("sh9", "l6", icon("book-open", "JAMES MEASE", "#FFD400")),
  sh("sh10", "l7", pxb(6941017, "a bottle of ketchup on a checked tablecloth")),
  *CTA(11)]},
"PublishCopy": copy("The first ketchup had no tomatoes",
 "The first ketchup didn't have a single tomato in it.\nThe word may come from Hokkien Chinese, where it meant the brine of pickled fish. From the 1600s, ketchup was made mostly from mushrooms, and other recipes used oysters, mussels, grapes and walnuts. The first known tomato ketchup recipe wasn't published until 1812.",
 ["ketchup", "foodhistory", "food", "history", "didyouknow"], ["ketchup history", "ketchup without tomatoes", "mushroom ketchup", "where does the word ketchup come from", "first tomato ketchup recipe"],
 "The first ketchup didn't have a single tomato in it.", "Motion-graphics explainer on how ketchup existed long before tomato ketchup.",
 "Ketchup on eggs: delicious or a crime? 🍳 Pick a side.", [{"url": KE, "title": "Ketchup"}]),
"Review": REV})

# ---------- Eraser ----------
ER = "https://en.wikipedia.org/wiki/Eraser"; ERT = "Eraser - Wikipedia"
out("eraser-accident.json", {
"ResearchDossier": doss("The first rubber eraser was an accident", "Before rubber erasers, tablets of wax and crustless bread were used to erase pencil marks. In 1770 Joseph Priestley described a substance excellently adapted to wiping black-lead-pencil marks from paper. Edward Nairne, an English optician and instrument maker, reportedly developed the first widely marketed rubber eraser; according to Nairne, he picked up a piece of rubber instead of breadcrumbs. In 1770 'rubber' meant any object used for rubbing; the word attached to the new material between 1770 and 1778. Vulcanisation (1839) made rubber durable. In 1858 Hymen Lipman patented attaching an eraser to a pencil; the patent was later invalidated.", "A happy accident that named a material.", [
  C("c1", "Before rubber erasers, tablets of wax and crustless bread were used to erase pencil marks.", [S(ER, ERT, "Crustless bread was used")]),
  C("c2", "In 1770 Joseph Priestley described a substance excellently adapted to wiping pencil marks from paper.", [S(ER, ERT, "excellently adapted to the purpose of wiping from paper the mark of black-lead-pencil")]),
  C("c3", "Edward Nairne, an English optician and instrument maker, reportedly developed the first widely marketed rubber eraser.", [S(ER, ERT, "reportedly developed the first widely marketed rubber eraser")]),
  C("c4", "According to Nairne, he inadvertently picked up a piece of rubber instead of breadcrumbs.", [S(ER, ERT, "he inadvertently picked up a piece of rubber instead of breadcrumbs")]),
  C("c5", "In 1770 'rubber' meant any object used for rubbing; the word became attached to the new material between 1770 and 1778.", [S(ER, ERT, "the word became attached to the new material sometime between 1770 and 1778")]),
  C("c6", "On March 30, 1858, Hymen Lipman received the first patent for attaching an eraser to the end of a pencil; it was later invalidated.", [S(ER, ERT, "received the first patent for attaching an eraser to the end of a pencil")])]),
"Script": {"headline": "The First Eraser Was an Accident", "cta": "Follow for more things hiding in plain sight.", "beats": [
  B("b1", "hook", [L("l1", "The first rubber eraser was an accident.", ["accident."], ["c4"], 0.35)]),
  B("b2", "history", [L("l2", "Before rubber, people rubbed out pencil marks with wax, or crustless bread.", ["bread."], ["c1"], 0.3),
                      L("l3", "Then in 1770, scientist Joseph Priestley wrote about a substance perfect for wiping pencil off paper.", ["perfect"], ["c2"], 0.3),
                      L("l4", "Instrument maker Edward Nairne is said to have sold the first popular rubber eraser.", ["first"], ["c3"], 0.3),
                      L("l5", "His story? He reached for breadcrumbs, and grabbed a piece of rubber by mistake.", ["mistake."], ["c4"], 0.4)]),
  B("b3", "mechanism", [L("l6", "Back then, a rubber was anything you rubbed with. Within a few years, the name stuck to the material itself.", ["stuck"], ["c5"], 0.4)]),
  B("b4", "twist", [L("l7", "And in 1858, Hymen Lipman patented the eraser on the end of a pencil.", ["patented"], ["c6"], 0.3),
                    L("l8", "Years later, the patent was thrown out. A pencil with an eraser was just two old inventions combined.", ["two"], ["c6"], 0.4)], "drop"),
  CTAB]},
"Storyboard": {"shots": [
  sh("sh1", "l1", pxb(10816479, "pencils with erasers on paper", focusY=0.5)),
  sh("sh2", "l2", pxb(8599593, "a slice of white bread", "Bread: the old eraser")),
  sh("sh3", "l3", tw("Joseph Priestley,", "1770", 10)),
  sh("sh4", "l3", icon("flask-conical", "PERFECT FOR WIPING PENCIL", "#20FFF6"), "substance"),
  sh("sh5", "l4", icon("eraser", "EDWARD NAIRNE", "#FFD400")),
  sh("sh6", "l5", pxb(8599591, "sliced white bread")),
  sh("sh6b", "l5", tw("grabbed by mistake:", "rubber", 10), "grabbed"),
  sh("sh7", "l6", tw("a rubber =", "anything you rub with", 14)),
  sh("sh7b", "l6", icon("eraser", "THE NAME STUCK", "#FFD400"), "Within"),
  sh("sh8", "l7", tw("pencil + eraser patent:", "1858", 10)),
  sh("sh8b", "l7", pxb(6952425, "pencils with erasers on the end"), "Hymen"),
  sh("sh9", "l8", versus({"icon": "pencil", "title": "PENCIL", "label": "Already invented"}, {"icon": "eraser", "title": "ERASER", "label": "Already invented"}, "none")),
  *CTA(10)]},
"PublishCopy": copy("The first rubber eraser was an accident",
 "The first rubber eraser was an accident.\nBefore rubber, people erased pencil with wax or crustless bread. In 1770, Joseph Priestley wrote about a substance perfect for wiping pencil off paper, and instrument maker Edward Nairne is said to have sold the first popular rubber eraser. By his own account, he grabbed rubber instead of breadcrumbs by mistake.",
 ["eraser", "pencil", "inventions", "history", "didyouknow"], ["eraser history", "why is it called rubber", "first rubber eraser", "Edward Nairne", "Hymen Lipman pencil eraser patent"],
 "The first rubber eraser was an accident.", "Motion-graphics explainer on how the rubber eraser was invented by accident.",
 "Eraser or rubber? 🇺🇸 vs 🇬🇧 What do you call it?", [{"url": ER, "title": "Eraser"}]),
"Review": REV})
