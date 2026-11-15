// Atomic's saved copy (its session store's message text) of the tables in the
// captures in atomic-tables.ts, read from the same disposable panes' sessions.

export const SAVED_CUT_TOP_TABLE = [
  "| Option | Add? | Why | Possible problems |",
  "|---|---|---|---|",
  "| **Alpha rule** | Yes | A clear rule gives the agent one predictable default, so behavior stays consistent across sessions. It can be enforced through a short `rules.md` entry that reviewers check against the phrase \"always verify before claiming done\" during a well-scoped three-part review. | Rules that are too rigid can block legitimate edge cases, so agents may follow the letter instead of the intent. A follow-up `lint` pass could flag false positives, and a team might read \"always\" as absolute even when a case-by-case judgment fits better. |",
  "| **Beta skill** | Maybe | A skill bundles reusable instructions and assets, such as a reference screenshot stored at /tmp/d40/shot.png, so agents load context only when needed. It fits a two-step flow where `SKILL.md` describes the trigger and the phrase \"use when capturing UI state\" drives discovery. | Skills only help if their descriptions trigger reliably. Vague wording means the agent skips them silently. Files under `/tmp` can vanish after a reboot, which leaves a broken reference, and the \"optional\" framing can lead to inconsistent, hit-or-miss adoption across sessions and contributors. |",
  "| **Gamma modeling** | No | Modeling the domain formally could clarify the relationships between entities and make long-term reasoning easier. A `schema.ts` file with typed records supports a \"single source of truth\" approach and gives a structured, well-documented foundation for future multi-layer features and integrations. | The upfront cost is high and the current scope doesn't justify it. An early `schema.ts` design may lock in wrong assumptions, and calling it \"future-proof\" can hide over-engineering, which turns a simple task into a long-running refactor across many dependent modules. |",
].join("\n");

export const SAVED_SHORT_TABLE = [
  "| Item | Status | Notes |",
  "|---|---|---|",
  "| **Alpha** | Done | Rule added and checked against current team conventions. |",
  "| **Beta** | Pending | Skill draft needs a clearer `SKILL.md` trigger description. |",
  "| **Gamma** | Skipped | Modeling deferred until project scope clearly justifies it. |",
].join("\n");

export const SAVED_NARROW_TABLE = [
  "| Fruit | Colour | Taste | Notes |",
  "|---|---|---|---|",
  "| Glimberry | Violet | Sweet and tangy | Glimberries grow in clusters on mountain vines and are often harvested at dawn while the morning dew still clings. |",
  "| Sunquash | Golden yellow | Mildly nutty | Farmers roast sunquash over open fires during autumn festivals, and its warm aroma fills entire villages for days. |",
  "| Frostplum | Pale blue | Cool and minty | The frostplum stays chilled inside for hours after picking, which makes it a favourite snack during hot summer afternoons. |",
  "| Emberfig | Deep red | Spicy-sweet | Emberfigs leave a gentle tingling warmth on the tongue, so cooks often add them to winter stews and spiced breads. |",
  "| Mossapple | Olive green | Earthy | Mossapples grow only in damp forest clearings, and foragers protect their secret picking spots from curious neighbours very carefully. |",
  "| Starmelon | Silver-white | Honeyed | Starmelons shimmer faintly under moonlight, and children in coastal towns believe that eating one brings good luck at sea. |",
  "| Thornpear | Brown | Sour | The thornpear's spiky skin must be peeled with thick gloves, but the sharp, sour flesh makes an excellent pickling ingredient. |",
  "| Velvetine | Dusty pink | Creamy | Velvetines have a soft, fuzzy skin, and their creamy flesh is commonly blended into smoothies and chilled breakfast puddings. |",
  "| Cloudgrape | Lavender | Light and airy | Cloudgrapes are so light that they nearly float in water, and vintners use them to make delicate sparkling wines. |",
  "| Rustberry | Copper orange | Tart | Rustberries stain everything they touch, so artisans traditionally crush them to make long-lasting dyes for wool and linen. |",
  "| Duskcherry | Dark purple | Rich and bitter | Duskcherries ripen only after sunset, and their bitter richness pairs surprisingly well with dark chocolate and roasted coffee. |",
  "| Lumikiwi | Bright green | Zesty | Lumikiwis glow softly in complete darkness, which once made them popular with night travellers crossing dense tropical jungles. |",
  "| Pebblenut | Grey | Salty-sweet | Despite its name, the pebblenut is a juicy fruit whose hard shell resembles river stones scattered along quiet streams. |",
  "| Saffronia | Amber | Floral | Saffronia trees bloom twice yearly, and the fruit's floral perfume is prized by bakers making delicate pastries and syrups. |",
  "| Tidelime | Sea green | Briny and sour | Tidelimes grow on salt-tolerant shrubs near beaches, and fishermen squeeze them over freshly grilled fish straight from the boat. |",
  "| Honeyhusk | Tan | Caramel-like | Honeyhusks must be dried in the sun for a week, after which their sugary flesh tastes almost exactly like caramel. |",
  "| Ripplequince | Marbled cream | Mellow | Ripplequinces have swirling patterns on their skin, and no two fruits ever look exactly alike, according to local orchard keepers. |",
  "| Bramblebell | Crimson | Juicy and bright | Bramblebells hang like tiny lanterns from thorny hedges, and birds compete fiercely with villagers to gather them each spring. |",
].join("\n");

export const SAVED_NARROW_TABLE_2 = [
  "| Fruit | Colour | Taste | Notes |",
  "|---|---|---|---|",
  "| Ripplequince | Golden amber | Honeyed and tart | Its skin ripples like water when pressed, and orchard keepers swear it ripens fastest beside running streams in late autumn. |",
  "| Bramblebell | Deep violet | Sweet with bitter finish | Growing on thorny vines shaped like hanging bells, it chimes faintly in strong wind, which is how foragers usually locate it. |",
  "| Moonpetalberry | Pale silver | Cool and creamy | Pickers harvest these berries only at night, because the petals that shield each cluster close tightly once sunlight touches them. |",
  "| Thistlewhorl | Speckled green | Peppery and bright | The spiral husk must be twisted off carefully, since the tiny bristles underneath can sting fingers for several hours afterward. |",
  "| Emberplume | Fiery orange | Smoky and sweet | Cooks prize it for roasting over open flames, where the flesh caramelises quickly and releases a scent similar to burnt sugar. |",
  "| Glimmerfig | Iridescent bronze | Rich and nutty | Each fig contains hundreds of shimmering seeds that catch candlelight, making it a popular centrepiece at winter feasts and weddings. |",
  "| Hollowmelon | Mossy teal | Mild and watery | Despite its large size, the melon is mostly hollow inside, and children often use the dried rinds as lanterns during festivals. |",
  "| Saffronquill | Bright yellow | Floral and spicy | Its long feather-shaped pods are dried and ground into a fragrant powder that local bakers stir into breads and spiced cakes. |",
  "| Duskapricot | Dusky rose | Velvety and tangy | Farmers believe the fruit tastes sweetest when picked at twilight, so harvest crews often work only during the final hour of daylight. |",
  "| Frostcurrant | Icy blue | Sharp and refreshing | These tiny currants survive heavy frost and actually grow sweeter after the first snowfall, making them a valuable mountain winter crop. |",
  "| Tanglewillowplum | Burgundy | Juicy and sour | The plums hang from drooping willow-like branches that tangle together, forming natural shaded tunnels where travellers like to rest at noon. |",
  "| Cinderpear | Charcoal grey | Earthy and mellow | Although its ashen skin looks unappetising, the pale flesh inside is tender and pairs wonderfully with sharp cheeses and dark bread. |",
  "| Lanternlychee | Glowing coral | Perfumed and delicate | A faint bioluminescence inside the shell makes ripe fruit glow softly, so villagers string them along paths during summer evening markets. |",
  "| Marrowmango | Butter yellow | Dense and buttery | Its unusually thick flesh can be sliced like cheese, and many households spread it on toast instead of butter during harvest season. |",
  "| Whisperwort | Pale lilac | Subtle and grassy | Legend claims eating one helps a person remember forgotten dreams, though most scientists politely dismiss this tale as charming folklore. |",
  "| Copperkumquat | Metallic copper | Zesty and bitter | The rind leaves a faint metallic tint on fingertips, which fades after washing, and the fruit makes an exceptional marmalade preserve. |",
  "| Starfallcherry | Midnight black | Deep and winey | These cherries form only on trees struck during meteor showers, according to growers, which explains their rarity and remarkably high price. |",
  "| Driftwoodguava | Weathered tan | Salty and sweet | Found growing near rocky coastlines, the guava absorbs sea spray, giving its pink flesh a gentle saltiness that pairs well with seafood. |",
].join("\n");
