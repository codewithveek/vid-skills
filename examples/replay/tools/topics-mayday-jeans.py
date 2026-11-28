import os
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mk.py")).read())

# ---------- Mayday ----------
MD = "https://en.wikipedia.org/wiki/Mayday"; MDT = "Mayday - Wikipedia"
out("mayday-french.json", {
"ResearchDossier": doss("Mayday has nothing to do with May", "Mayday is the phonetic equivalent of the French m'aider. It was conceived in the early 1920s by Frederick Stanley Mockford, officer-in-charge of radio at Croydon Airport, who was asked for a distress word every pilot and ground staff would understand; since much traffic was between Croydon and Le Bourget in Paris, he proposed mayday. It was introduced for cross-Channel flights in February 1923, partly owing to the difficulty of distinguishing the letter S by telephone. In 1927 it was adopted as the radiotelephone distress call in addition to SOS. It is said three times in a row.", "A French plea hiding in an English word.", [
  C("c1", "Mayday is the phonetic equivalent of the French m'aider ('help me').", [S(MD, MDT, "the phonetic equivalent of the French m'aider")]),
  C("c2", "Mayday was conceived in the early 1920s by Frederick Stanley Mockford, officer-in-charge of radio at Croydon Airport, England.", [S(MD, MDT, "officer-in-charge of radio at Croydon Airport")]),
  C("c3", "Mockford was asked to think of a word that would indicate distress and be easily understood by all pilots and ground staff in an emergency.", [S(MD, MDT, "would easily be understood by all pilots and ground staff in an emergency")]),
  C("c4", "Since much of the air traffic was between Croydon and Le Bourget Airport in Paris, he proposed mayday.", [S(MD, MDT, "Since much of the air traffic at the time was between Croydon and Le Bourget Airport in Paris")]),
  C("c5", "A 1923 report cited the difficulty of distinguishing the letter S by telephone.", [S(MD, MDT, "owing to the difficulty of distinguishing the letter 'S' by telephone")]),
  C("c6", "In 1927 the International Radiotelegraph Convention adopted mayday as the voice distress call, in addition to SOS.", [S(MD, MDT, "in addition to the SOS radiotelegraph")]),
  C("c7", "Convention requires the word be repeated three times in a row.", [S(MD, MDT, "repeated three times in a row")])]),
"Script": {"headline": "Mayday Has Nothing to Do With May", "cta": "Follow for more things hiding in plain sight.", "beats": [
  B("b1", "hook", [L("l1", "Mayday has nothing to do with the month of May.", ["nothing"], ["c1"], 0.35)]),
  B("b2", "history", [L("l2", "It's French. It comes from m'aider. Help me.", ["Help"], ["c1"], 0.4),
                      L("l3", "In the early 1920s, Frederick Mockford ran the radio at Croydon Airport, in England.", ["Croydon"], ["c2"], 0.3),
                      L("l4", "He was asked for a distress word that every pilot and every ground crew would understand.", ["every"], ["c3"], 0.3),
                      L("l5", "Most flights back then went between Croydon and Le Bourget, in Paris. So he picked a French one.", ["French"], ["c4"], 0.4)]),
  B("b3", "mechanism", [L("l6", "Over a crackly phone line, the S in SOS was easy to mishear.", ["mishear."], ["c5"], 0.3),
                        L("l7", "By 1927, Mayday was the official spoken distress call, alongside SOS.", ["official"], ["c6"], 0.4)]),
  B("b4", "twist", [L("l8", "And you always say it three times. Mayday, mayday, mayday.", ["three"], ["c7"], 0.4)], "drop"),
  CTAB]},
"Storyboard": {"shots": [
  sh("sh1", "l1", pxb(4879871, "a pilot wearing a radio headset", focusY=0.4)),
  sh("sh3", "l2", tw("m'aider =", "help me", 10)),
  sh("sh4", "l3", broll("James Jimmy Jeffs at work Croydon", "a 1920s control room at Croydon Airport", "Croydon Airport")),
  sh("sh4b", "l3", tw("Croydon Airport:", "early 1920s", 12), "Croydon"),
  sh("sh5", "l4", pxb(12128384, "a pilot at the controls with a headset")),
  sh("sh5b", "l4", icon("radio", "ONE WORD EVERYONE GETS", "#20FFF6"), "every"),
  sh("sh6", "l5", versus({"icon": "plane-takeoff", "title": "CROYDON", "label": "London"}, {"icon": "plane-landing", "title": "LE BOURGET", "label": "Paris"}, "none")),
  sh("sh6b", "l5", tw("so, in French:", "m'aider", 10), "So"),
  sh("sh7", "l6", icon("radio-tower", "THE S GETS LOST", "#FFD400")),
  sh("sh8", "l7", tw("official distress call:", "1927", 10)),
  sh("sh9", "l8", tw("say it:", "× 3", 8)),
  sh("sh9b", "l8", pxb(20051146, "two pilots in a cockpit"), "Mayday,"),
  *CTA(10)]},
"PublishCopy": copy("Mayday has nothing to do with May",
 "Mayday has nothing to do with the month of May.\nIt comes from the French m'aider, \"help me\". In the early 1920s, Frederick Mockford ran the radio at Croydon Airport and needed a distress word every pilot would understand. With most flights going between Croydon and Paris, he picked a French one. By 1927 it was the official spoken distress call, alongside SOS.",
 ["mayday", "aviation", "etymology", "history", "didyouknow"], ["why do pilots say mayday", "mayday meaning", "mayday French m'aider", "Croydon Airport mayday", "mayday three times"],
 "Mayday has nothing to do with the month of May.", "Motion-graphics explainer on the French origin of the distress call Mayday.",
 "Be honest: did you think Mayday came from May Day? 👀", [{"url": MD, "title": "Mayday"}]),
"Review": REV})

# ---------- Jeans watch pocket ----------
JN = "https://en.wikipedia.org/wiki/Jeans"; JNT = "Jeans - Wikipedia"
PK = "https://en.wikipedia.org/wiki/Pocket"; PKT = "Pocket - Wikipedia"
out("jeans-watch-pocket.json", {
"ResearchDossier": doss("The tiny jeans pocket was made for a pocket watch", "Jacob Davis and Levi Strauss patented riveted work pants on May 20, 1873 (US patent 139,121, 'Improvement in Fastening Pocket-Openings'); the 1873 design had two front pockets and one back patch pocket. The small riveted watch pocket was first added by Levi Strauss in the late 1870s. A watch pocket, or fob pocket, is a small compartment originally for holding a pocket watch; it is also called a coin pocket.", "A pocket that outlived its purpose.", [
  C("c1", "Jacob Davis and Levi Strauss patented their riveted pants on May 20, 1873.", [S(JN, JNT, "patented by Davis and Levi Strauss on May 20, 1873.")]),
  C("c2", "The 1873 design had two pockets in the front and a patch pocket on the back right, reinforced with copper rivets.", [S(JN, JNT, "there were two pockets in the front and a patch pocket on the back right")]),
  C("c3", "The small riveted watch pocket was first added by Levi Strauss to their jeans in the late 1870s.", [S(JN, JNT, "The small riveted watch pocket was first added by Levi Strauss to their jeans in the late 1870s.")]),
  C("c4", "A watch pocket or fob pocket is a small compartment, originally for holding a pocket watch.", [S(PK, PKT, "originally for holding a pocket watch.")]),
  C("c5", "It is also described as a coin pocket.", [S(PK, PKT, "coin- or watch-pocket")], "medium")]),
"Script": {"headline": "That Tiny Jeans Pocket Was for a Watch", "cta": "Follow for more things hiding in plain sight.", "beats": [
  B("b1", "hook", [L("l1", "That tiny pocket on your jeans was made for a pocket watch.", ["watch."], ["c4"], 0.35)]),
  B("b2", "history", [L("l2", "In 1873, Jacob Davis and Levi Strauss patented work pants held together with copper rivets.", ["rivets."], ["c1"], 0.3),
                      L("l3", "Those first jeans had just two pockets in the front, and one on the back.", ["two"], ["c2"], 0.35),
                      L("l4", "Then, in the late 1870s, Levi Strauss added one more. A small, riveted watch pocket.", ["watch"], ["c3"], 0.4)]),
  B("b3", "mechanism", [L("l5", "It was made to hold one thing. A pocket watch.", ["hold"], ["c4"], 0.4)]),
  B("b4", "twist", [L("l6", "Pocket watches went out of style. The pocket never left.", ["never"], ["c3"], 0.3),
                    L("l7", "Today most people just call it the coin pocket.", ["coin"], ["c5"], 0.4)], "drop"),
  CTAB]},
"Storyboard": {"shots": [
  sh("sh1", "l1", pxb(14840593, "close-up of a jeans front pocket", focusY=0.4)),
  sh("sh2", "l1", pxb(35192654, "a hand holding a pocket watch"), "watch."),
  sh("sh3", "l2", tw("riveted jeans patent:", "1873", 10)),
  sh("sh4", "l2", pxb(10133273, "denim stitching and a pocket"), "copper"),
  sh("sh5", "l3", versus({"icon": "copy", "title": "FRONT", "label": "Two pockets"}, {"icon": "square", "title": "BACK", "label": "One pocket"}, "none")),
  sh("sh6", "l4", tw("watch pocket added:", "late 1870s", 12)),
  sh("sh6b", "l4", pxb(17539483, "vintage pocket watches on a table"), "small,"),
  sh("sh7", "l5", icon("watch", "MADE FOR A WATCH", "#FFD400")),
  sh("sh8", "l6", pxb(18359903, "an antique pocket watch")),
  sh("sh8b", "l6", pxb(10133278, "folded blue jeans showing the pockets"), "pocket"),
  sh("sh9", "l7", icon("coins", "THE COIN POCKET", "#FFD400")),
  *CTA(10)]},
"PublishCopy": copy("That tiny jeans pocket was made for a pocket watch",
 "That tiny pocket on your jeans was made for a pocket watch.\nJacob Davis and Levi Strauss patented riveted work pants in 1873, with two front pockets and one on the back. In the late 1870s, Levi Strauss added a small riveted watch pocket. Pocket watches went out of style, but the pocket never left.",
 ["jeans", "denim", "fashionhistory", "history", "didyouknow"], ["jeans small pocket", "jeans watch pocket", "why do jeans have a tiny pocket", "Levi Strauss history", "coin pocket"],
 "That tiny pocket on your jeans was made for a pocket watch.", "Motion-graphics explainer on why jeans have a tiny front pocket.",
 "What do you actually keep in the tiny pocket? 👖 Wrong answers only.", [{"url": JN, "title": "Jeans"}, {"url": PK, "title": "Pocket"}]),
"Review": REV})
