# Browser demo art

## Last Hearth

The demo bundles selected 3D models locally. There is no third-party model CDN at runtime. Geometry, skeletons, materials, and textures are genuine artist-made assets; the landscape, berry bushes, campfire, role tools, selection markers, and UI are authored in this repository.

| Files in `public/assets/`                                                | Author and original pack                                                                                                                                                     | License | Changes                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `knight.glb`, `rogue.glb`, `barbarian.glb`                               | Kay Lousberg, [KayKit Character Pack: Adventurers](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/tree/672074b73ba276876a19e8816ecdc5241817ab47) | CC0 1.0 | Ten original animation clips retained; unused animation data removed without re-encoding retained geometry, textures, or animation data. Equipment visibility, scale, role tools, and animation selection change at runtime. |
| `hall.glb`, `house.glb`, `tower.glb`, `wall.glb`, `tree.glb`, `rock.glb` | Kay Lousberg, [KayKit Medieval Hexagon Pack](https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0/tree/84fa4e91af6a88989be7c99e0891cede11f2ca38)           | CC0 1.0 | Original glTF geometry, buffers, and textures packaged into self-contained GLB. Scale, rotation, construction transparency, and damage appearance change at runtime.                                                         |
| `orc.glb`                                                                | Quaternius, [Ultimate Monsters](https://quaternius.com/packs/ultimatemonsters.html)                                                                                          | CC0 1.0 | Original `Big/glTF/Orc.gltf` packaged into self-contained GLB. Original animations and embedded texture retained. Scale and animation selection change at runtime.                                                           |

Downloaded September 16, 2026. Full supplied license files are preserved as `LICENSE-KayKit-Characters.txt`, `LICENSE-KayKit-Village.txt`, and `LICENSE-Quaternius.txt`. The Quaternius license file supplied in the author's Ultimate Monsters folder says “Ultimate Platformer Pack” in its heading; both that supplied license and the author's Ultimate Monsters page explicitly state CC0. The original download folder is [linked here](https://drive.google.com/drive/folders/18m4KpzpEzhC9wl7jzr6dUc0N8Jozr79C); the specific [Orc glTF file](https://drive.google.com/file/d/17675H4Owu5FeHUk_7Goyc9TKI5YK3cEM/view) is in its `Big/glTF` directory.

Original KayKit village filenames:

- `Assets/gltf/buildings/red/building_tavern_red.gltf` → `hall.glb`
- `Assets/gltf/buildings/red/building_home_A_red.gltf` → `house.glb`
- `Assets/gltf/buildings/red/building_tower_A_red.gltf` → `tower.glb`
- `Assets/gltf/buildings/neutral/wall_straight.gltf` → `wall.glb`
- `Assets/gltf/decoration/nature/tree_single_A.gltf` → `tree.glb`
- `Assets/gltf/decoration/nature/rock_single_B.gltf` → `rock.glb`

Human animation clips: `Idle`, `Walking_A`, `Running_A`, `Interact`, `PickUp`, `1H_Melee_Attack_Chop`, `Sit_Floor_Idle`, `Death_A`, `Death_A_Pose`, `Unarmed_Melee_Attack_Punch_A`. Independent skeleton clones allow each NPC to walk, work, fight, or die independently.

UI typography uses Libre Baskerville, Barlow Condensed, and DM Mono via Google Fonts (SIL Open Font License). Three.js and its GLTFLoader, SkeletonUtils, and OrbitControls are MIT-licensed code dependencies, not artwork.

## Slipstream

Slipstream's artwork is authored procedurally in
[`src/driving/renderer.js`](src/driving/renderer.js) and is covered by this
repository's [MIT license](../LICENSE). It does not load the Last Hearth model
packs or external vehicle models.

| Asset                                     | Construction                                                                                                                                          |
| :---------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Four colored racing cars and grey traffic | Shared instanced geometry for bodies, glass cabins, wheels, hubs, trim, headlights and brake lamps. The vehicle shapes are original stylized designs. |
| Circuit                                   | Mesh-built road, lane markings, curbs, timing stripe, wet asphalt and a separate pit entry/service/exit lane.                                         |
| Paddock and landscape                     | Procedural garage, control tower, grandstand, seats, pit canopy, trees, shrubs, cones and gravel patches.                                             |
| Number tags and signs                     | Small canvas-generated textures using system Arial; no downloaded sign or badge images.                                                               |
| Racing effects                            | Instanced boost shapes, low-poly smoke, skid marks, selection ring and damage/retirement appearance changes.                                          |

Slipstream's page typography uses DM Sans, Barlow Condensed and DM Mono via
Google Fonts (SIL Open Font License). Three.js and `BufferGeometryUtils` are
MIT-licensed code dependencies. The pinned Qwen model and WebLLM runtime have
their own notices and are separate from these graphics; see
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## World 1-1

`src/mario/renderer.js` draws original pixel artwork with Canvas2D: a red-cap
plumber, mushrooms, Goombas, pipes, terrain, blocks, coins, flag and castle. There
are no downloaded or extracted Nintendo sprites, music or ROM files. The course
is an approximate playable recreation of Super Mario Bros. World 1-1, not an
emulated or exact port. Super Mario Bros. and its characters originate with
Nintendo; this is an independent technical demo.
