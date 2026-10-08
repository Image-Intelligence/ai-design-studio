/**
 * Putting a motion made for one skeleton onto another character.
 *
 * Text-to-motion (Hunyuan Motion) comes on its own standard humanoid
 * skeleton; the auto-rig (Meshy) gives the character a different one. Bones
 * are matched by MEANING, not by exact name: each name is reduced to a
 * canonical humanoid part (hips, spine, chest, neck, head, and per side:
 * shoulder, upper arm, forearm, hand, thigh, shin, foot, toe) from the naming
 * schemes in the wild (Mixamo / Meshy "LeftUpLeg", SMPL "left_knee",
 * "L_Hip", Blender ".L"...). The motion is then baked onto the character
 * frame by frame: each matched bone turns in the world exactly as its source
 * bone turns away from ITS rest pose. That holds whatever way the two rigs
 * point their bone axes (and through an FBX's Z-up root), as long as both rest
 * in a T-pose - which auto-rigged characters and SMPL do. The character keeps
 * its own proportions; only the hips travel, scaled to its leg length.
 * (three's SkeletonUtils.retargetClip was tried first: it flipped the legs
 * of Hunyuan motions onto Meshy rigs.)
 *
 * The same skeleton (a clip-library clip made on this rig) needs none of
 * that: its tracks already name the character's bones.
 */
import type * as THREE_NS from "three"

const SIDE = (n: string): "l" | "r" | "" => {
  if (/(^|[^a-z])(left|l)([^a-z]|$)|^left|left$|\.l$|_l$|^l_|lft/.test(n)) return "l"
  if (/(^|[^a-z])(right|r)([^a-z]|$)|^right|right$|\.r$|_r$|^r_|rgt/.test(n)) return "r"
  return ""
}

/**
 * SMPL / SMPL-H (Hunyuan Motion's skeleton) names joints, not bones, and its
 * words mean something else: L_Hip is the thigh, L_Ankle the foot, L_Foot the
 * toe, L_Collar the clavicle and L_Shoulder the UPPER ARM. A skeleton with
 * collar or elbow joints is read that way.
 */
export type BoneScheme = "smpl" | "generic"
export const boneScheme = (names: string[]): BoneScheme => (names.some(n => /collar/i.test(n)) && names.some(n => /elbow|wrist/i.test(n)) ? "smpl" : "generic")
const SMPL: Record<string, string> = { hip: "thigh", knee: "shin", ankle: "foot", foot: "toe", collar: "shoulder", shoulder: "upperarm", elbow: "forearm", wrist: "hand" }
const SMPL_TRUNK: Record<string, string> = { pelvis: "hips", spine1: "spine", spine2: "spine2", spine3: "chest", neck: "neck", head: "head" }

/** "mixamorig:LeftForeArm" -> "l.forearm"; "left_knee" -> "l.shin"; "Spine2" -> "chest". */
export function canonicalBone(raw: string, scheme: BoneScheme = "generic"): string | null {
  const n = raw.toLowerCase().replace(/^.*[:|]/, "").replace(/\s+/g, "_")
  const s = SIDE(n)
  const core = n.replace(/left|right|\.l$|\.r$|_l$|_r$|^l_|^r_|lft|rgt/g, "").replace(/[_.\-]/g, "")
  const sided = (part: string) => (s ? `${s}.${part}` : null)
  if (scheme === "smpl") return s ? (SMPL[core] ? sided(SMPL[core]) : null) : (SMPL_TRUNK[core] ?? null)
  if (/^(hips?|pelvis|root_?hips?)$/.test(core) && !s) return "hips"
  if (/toe|ball/.test(core)) return sided("toe")
  if (/foot|ankle/.test(core)) return sided("foot")
  if (/upleg|thigh|upperleg/.test(core) || (core === "hip" && s)) return sided("thigh")
  if (/knee|calf|shin|lowerleg|^leg$/.test(core)) return sided("shin")
  if (/hand|wrist/.test(core) && !/thumb|index|middle|ring|pinky|finger/.test(core)) return sided("hand")
  if (/forearm|elbow|lowerarm/.test(core)) return sided("forearm")
  if (/shoulder|clavicle|collar/.test(core) && s) return sided("shoulder")
  if (/^(arm|upperarm)$/.test(core) || (/arm/.test(core) && !/fore|lower/.test(core))) return sided("upperarm")
  if (/head/.test(core) && !/end|top/.test(core)) return "head"
  if (/neck/.test(core)) return "neck"
  if (/^(spine3|spine2|chest|upperchest|spine02|spine03)$/.test(core)) return "chest"
  if (/^(spine1|spine01)$/.test(core)) return "spine2"
  if (/^(spine|spine0|abdomen|torso)$/.test(core)) return "spine"
  return null
}

const skinnedOf = (root: THREE_NS.Object3D) => {
  let found: THREE_NS.SkinnedMesh | null = null
  root.traverse(o => { if (!found && (o as THREE_NS.SkinnedMesh).isSkinnedMesh) found = o as THREE_NS.SkinnedMesh })
  return found as THREE_NS.SkinnedMesh | null
}
const bonesOf = (root: THREE_NS.Object3D) => {
  const out: THREE_NS.Bone[] = []
  root.traverse(o => { if ((o as THREE_NS.Bone).isBone) out.push(o as THREE_NS.Bone) })
  return out
}

/** The source clip as a clip for `target` (named `name`), or null if the skeletons do not match up. */
export function retargetOnto(T: typeof THREE_NS, target: THREE_NS.Object3D, sourceRoot: THREE_NS.Object3D, clip: THREE_NS.AnimationClip, name: string): THREE_NS.AnimationClip | null {
  const skin = skinnedOf(target)
  if (!skin) return null
  const targetNames = new Set(skin.skeleton.bones.map(b => b.name))
  const tracked = [...new Set(clip.tracks.map(t => t.name.split(".")[0]))]
  // Same rig: the clip already speaks this skeleton's names
  if (tracked.length && tracked.filter(n => targetNames.has(n)).length / tracked.length > 0.8) {
    const c = clip.clone()
    c.name = name
    return c
  }
  // One bone per name: an FBX can carry the skeleton once per mesh (Hunyuan's: 16 copies)
  const seen = new Set<string>()
  const srcBones = bonesOf(sourceRoot).filter(b => !seen.has(b.name) && !!seen.add(b.name))
  if (srcBones.length < 10) return null
  const srcScheme = boneScheme(srcBones.map(b => b.name))
  const tgtScheme = boneScheme(skin.skeleton.bones.map(b => b.name))
  const byCanon = new Map<string, string>()
  for (const b of srcBones) { const c = canonicalBone(b.name, srcScheme); if (c && !byCanon.has(c)) byCanon.set(c, b.name) }
  const names: Record<string, string> = {}
  let hipTarget: string | null = null, hipSource: string | null = null
  for (const b of skin.skeleton.bones) {
    const c = canonicalBone(b.name, tgtScheme)
    const src = c ? byCanon.get(c) : undefined
    if (src) { names[b.name] = src; if (c === "hips") { hipTarget = b.name; hipSource = src } }
  }
  if (Object.keys(names).length < 10 || !hipTarget || !hipSource) return null
  return bake(T, target, skin, sourceRoot, clip, names, hipTarget, hipSource, name)
}

/** Kept for the viewer's call order; the bake needs nothing loaded. */
export async function preloadRetarget() {}

function bake(T: typeof THREE_NS, target: THREE_NS.Object3D, skin: THREE_NS.SkinnedMesh, sourceRoot: THREE_NS.Object3D, clip: THREE_NS.AnimationClip,
  names: Record<string, string>, hipTarget: string, hipSource: string, name: string): THREE_NS.AnimationClip | null {
  // The source bones exactly as the mixer binds them (first match by name)
  const src = new Map<string, THREE_NS.Object3D>()
  for (const s of new Set(Object.values(names))) { const n = T.PropertyBinding.findNode(sourceRoot, s); if ((n as THREE_NS.Object3D | undefined)?.isObject3D) src.set(s, n as THREE_NS.Object3D) }
  const bones = skin.skeleton.bones
  const depth = (b: THREE_NS.Object3D) => { let d = 0; for (let p = b.parent; p; p = p.parent) d++; return d }
  const order = [...bones].sort((a, b) => depth(a) - depth(b))   // parents before children
  const boneSet = new Set<THREE_NS.Object3D>(bones)
  const wq = (o: THREE_NS.Object3D) => new T.Quaternion().setFromRotationMatrix(new T.Matrix4().extractRotation(o.matrixWorld))
  const wpos = (o: THREE_NS.Object3D) => new T.Vector3().setFromMatrixPosition(o.matrixWorld)
  const lowest = (root: THREE_NS.Object3D, list: THREE_NS.Object3D[]) => Math.min(...list.map(o => wpos(o).y), wpos(root).y)

  // Rest poses: the character's bind pose, the motion's file pose
  skin.skeleton.pose()
  target.updateMatrixWorld(true)
  const restLocal = new Map(bones.map(b => [b, b.quaternion.clone()]))
  const restTgtW = new Map(bones.map(b => [b, wq(b)]))
  const tHip = bones.find(b => b.name === hipTarget)!
  const restTgtHip = wpos(tHip)
  const tgtLeg = restTgtHip.y - lowest(tHip, bones.filter(b => /foot|toe|ankle/i.test(b.name)))
  sourceRoot.updateMatrixWorld(true)
  const restSrcW = new Map([...src].map(([k, o]) => [k, wq(o)]))
  const sHip = src.get(hipSource)!
  const restSrcHip = wpos(sHip)
  const srcLeg = restSrcHip.y - lowest(sHip, [...src.values()].filter(o => /foot|toe|ankle/i.test(o.name)))
  const scale = srcLeg > 1e-6 && tgtLeg > 1e-6 ? tgtLeg / srcLeg : 1

  const mixer = new T.AnimationMixer(sourceRoot)
  mixer.clipAction(clip).play()
  const fps = 30, frames = Math.max(2, Math.round(clip.duration * fps) + 1)
  const times = new Float32Array(frames)
  const qv = new Map(order.map(b => [b, new Float32Array(frames * 4)]))
  const hv = new Float32Array(frames * 3)
  const curW = new Map<THREE_NS.Object3D, THREE_NS.Quaternion>()
  const parentW = (b: THREE_NS.Object3D) => (b.parent && boneSet.has(b.parent) ? curW.get(b.parent)! : b.parent ? wq(b.parent) : new T.Quaternion())

  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, f / fps)
    times[f] = t
    mixer.setTime(t)
    sourceRoot.updateMatrixWorld(true)
    curW.clear()
    for (const b of order) {
      const s = names[b.name]
      const node = s ? src.get(s) : undefined
      const pw = parentW(b)
      // matched: the source's turn away from rest, applied to this bone's rest; unmatched: keep its rest local turn
      const w = node ? wq(node).multiply(restSrcW.get(s!)!.clone().invert()).multiply(restTgtW.get(b)!) : pw.clone().multiply(restLocal.get(b)!)
      curW.set(b, w)
      const local = pw.clone().invert().multiply(w)
      qv.get(b)!.set([local.x, local.y, local.z, local.w], f * 4)
    }
    // Hips travel: the source's move from rest, scaled to this character, in the hips' parent space
    const moved = restTgtHip.clone().add(wpos(sHip).sub(restSrcHip).multiplyScalar(scale))
    const local = tHip.parent ? tHip.parent.worldToLocal(moved) : moved
    hv.set([local.x, local.y, local.z], f * 3)
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(sourceRoot)

  const tracks: THREE_NS.KeyframeTrack[] = order.map(b => new T.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, qv.get(b)!))
  tracks.push(new T.VectorKeyframeTrack(`${tHip.name}.position`, times, hv))
  // Back to the bind pose: the bake moved nothing on the character, but be sure
  skin.skeleton.pose()
  return new T.AnimationClip(name, clip.duration, tracks)
}
