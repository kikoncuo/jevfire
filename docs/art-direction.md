# Artwork and generation record

Final assets: [`assets/hero.png`](../assets/hero.png) and [`assets/game-agent.png`](../assets/game-agent.png).
Generated with the **built-in image generation tool**, not the API/CLI fallback.
The hero was edited to **JEVFIRE** after the user specified that the name must reference **JEV**, the original inspiration.

Both raster images are concept artwork. They do not show captured gameplay or measured performance. The benchmark chart is separately generated from actual recorded timings by [`scripts/render_benchmarks.py`](../scripts/render_benchmarks.py).

## Hero: initial composition prompt

```text
Use case: ads-marketing
Asset type: wide GitHub repository hero banner, landscape 3:1
Primary request: Create an extraordinary polished brand artwork for the open-source CUDA LLM decision engine named BRANCHFIRE, with tagline "One context. Many decisions."
Scene/backdrop: almost black obsidian background with subtle film grain and precision engineering grid, no UI chrome.
Subject: A single molten amber computational core splitting into many elegant branching trails of fire and light, like a sculptural neural tree made of copper and luminous fiber optics. Convey one source powering many simultaneous decisions. Sophisticated tangible 3D material with restrained electric teal highlights.
Composition/framing: bold spacious editorial banner; huge ivory uppercase BRANCHFIRE wordmark on the left with the exact smaller tagline below; spectacular luminous branching sculpture on the right, with fine sparks and shallow depth of field; excellent legibility at GitHub README width.
Style/medium: cinematic high-end 3D render meets Swiss typography and scientific instrument photography.
Color palette: charcoal black, warm ivory, vivid amber, copper, tiny teal accents.
Text (verbatim): "BRANCHFIRE" and "One context. Many decisions."
Constraints: Only those two text strings; no performance numbers, no charts, no fake screenshots, no extra logos or watermark. Clean balanced composition with broad safe margins. Original design.
```

## Hero: final edit prompt

```text
Use case: text-localization
Asset type: GitHub repository hero banner
Edit target: attached original hero banner.
Primary request: Rename the hero wordmark from BRANCHFIRE to JEVFIRE, to reference the project's inspiration JEV.
Text (verbatim): "JEVFIRE" and "One context. Many decisions."
Constraints: Change only the large brand wordmark to JEVFIRE; preserve the exact existing tagline, obsidian/copper/amber palette, cinematic branching sculpture, original wide 3:1 composition, typography style and excellent legibility. Rebalance the shorter wordmark within its left text area. No other text.
```

## Game-agent illustration: final prompt

```text
Use case: stylized-concept
Asset type: wide landscape illustration for Branchfire GitHub README game-agent use case
Primary request: A visually breathtaking isometric miniature futuristic racing game diorama showing how one AI context can branch into several game control decisions.
Scene/backdrop: dark obsidian architectural model stage, sweeping compact racetrack with amber edge lights, a single beautiful small ivory and copper racing car entering a bend, stylized traffic cones and track barriers. Clear miniature simulated-game feeling, not a real autonomous vehicle.
Subject: suspended above the racetrack is a luminous amber crystalline decision core with three fine branching fiber-optic paths connecting to three elegantly rendered floating action tiles. Tiles show only the exact short words STEER, BRAKE, BOOST in uppercase. The BRAKE tile glows amber, others soft ivory and teal.
Style/medium: premium cinematic 3D toy-world illustration, meticulous surfaces, editorial game-engine concept art; subtle grain, soft volumetric lights; stylized and tasteful.
Composition/framing: landscape 2:1 with racing diorama on lower two-thirds and action core/tiles above, strong spatial hierarchy, generous dark margins.
Color palette: charcoal, copper, amber, ivory, small teal accents matching Branchfire.
Text (verbatim): "STEER", "BRAKE", "BOOST".
Constraints: Concept illustration only, no charts, no latency numbers, no claimed performance, no real product screenshot, no logos, no watermark, no extra text.
```
