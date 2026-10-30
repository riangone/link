/**
 * Dev-only contact sheet: renders one rig per sampled frame so animation can be reviewed
 * without real-time playback.  Usage:
 *   poses.html?move=PUNCH_2&frames=0,3,5,7,10,16&view=side|front|three|face&p2=1
 *   poses.html?state=WALK&frames=0,6,12,18      (state = IDLE|WALK|RUN|HIT_STUN|KNOCKED_DOWN|WAKEUP|BLOCK|VICTORY)
 * Each rig is simulated from a settled idle at 60 Hz so springs/IK look exactly as in game.
 */
import * as THREE from '../vendor/three.module.js';
import { MOVES, FIGHTER_STATE, MOVE_SPEED } from '../src/core/Constants.js';
import { ProceduralFighterMesh } from '../src/render/ProceduralFighterMesh.js';

const qs = new URLSearchParams(location.search);
const moveId = qs.get('move');
const stateName = qs.get('state') || (moveId ? 'ATTACK' : 'IDLE');
const frames = (qs.get('frames') || '0,4,8,12,16,20').split(',').map(Number);
const view = qs.get('view') || 'side';
const isP1 = qs.get('p2') !== '1';
const zoom = Number(qs.get('zoom') || 1);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141a2e);
scene.add(new THREE.HemisphereLight(0x8090d0, 0x201030, 1.3));
const key = new THREE.DirectionalLight(0xfff1e6, 2.6);
key.position.set(3, 8, 6); key.castShadow = true;
key.shadow.camera.left = -12; key.shadow.camera.right = 12; key.shadow.camera.top = 4; key.shadow.camera.bottom = -2;
key.shadow.mapSize.set(2048, 1024);
scene.add(key);
const rimC = new THREE.DirectionalLight(0x22e6ff, 2.4); rimC.position.set(-6, 3, -4); scene.add(rimC);
const rimM = new THREE.DirectionalLight(0xff2a8a, 2.2); rimM.position.set(6, 3, -4); scene.add(rimM);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), new THREE.MeshStandardMaterial({ color: 0x22263a, roughness: 0.8 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

const spacing = 2.3;
const n = frames.length;
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 200);
const width = n * spacing;
const dist = (width / 2) / Math.tan(THREE.MathUtils.degToRad(30) / 2) / (innerWidth / innerHeight) / zoom + 2;
const cx = (n - 1) * spacing / 2;
if (view === 'front') cam.position.set(cx - dist * 0.25, 1.1, dist); // fighters face +x; front-ish view
else if (view === 'three') cam.position.set(cx + 2, 2.2, dist * 0.95);
else if (view === 'face') { cam.position.set(cx + 0.9, 1.6, 1.6); }
else if (view === 'top') { cam.position.set(cx, dist * 0.9, 0.01); }
else cam.position.set(cx, 1.0, dist);
if (view === 'face') cam.lookAt(cx, 1.45, 0); else if (view === 'top') cam.lookAt(cx, 0, 0); else
cam.lookAt(cx, 0.95, 0);

const move = moveId ? MOVES[moveId] : null;
const DT = 1 / 60;
const labels = [];

function makeFighter() {
    return {
        id: isP1 ? 'p1' : 'p2', state: FIGHTER_STATE.IDLE, stateTimer: 0, currentMove: null,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, facing: 1, facingAngle: 0, isGrounded: true, isBlocking: false,
        hp: 100, maxHp: 100, hitStunDuration: 18
    };
}

const raw = qs.get('raw') ? JSON.parse(qs.get('raw')) : null;   // [{key:value,...}, ...] semantic poses, no springs
import { makePose } from '../src/render/AnimationLibrary.js';
if (raw) frames.length = 0, raw.forEach((_, i) => frames.push(i));
frames.forEach((frame, i) => {
    if (raw) {
        const mesh = new ProceduralFighterMesh(scene, isP1);
        const f = makeFighter(); f.x = i * spacing;
        mesh.pose = makePose(raw[i]);
        mesh.applyRoot(f); mesh.applyPose(mesh.pose, false);
        mesh.updateDecals && mesh.updateDecals(f);
        labels.push(JSON.stringify(raw[i]));
        return;
    }
    const mesh = new ProceduralFighterMesh(scene, isP1);
    const f = makeFighter();
    const baseX = i * spacing;
    f.x = baseX;
    let t = 0;
    for (let k = 0; k < 60; k++) { mesh.update(f, t, DT); t += DT; }   // settle in idle
    f.state = FIGHTER_STATE[stateName] || stateName;
    f.stateTimer = 0;
    f.currentMove = move;
    if (f.state === FIGHTER_STATE.BLOCK) f.isBlocking = true;
    const speed = f.state === FIGHTER_STATE.RUN ? MOVE_SPEED.RUN : MOVE_SPEED.WALK_FORWARD;
    for (let k = 0; k <= frame; k++) {
        if (f.state === FIGHTER_STATE.WALK || f.state === FIGHTER_STATE.RUN) { f.vx = speed; f.x += speed * DT; }
        mesh.update(f, t, DT);
        if (k < frame) { f.stateTimer++; t += DT; }
    }
    // keep rigs on a fixed grid even while walking
    const shift = baseX - f.x;
    for (const o of [mesh.root, mesh.blob, mesh.ring]) o.position.x += shift;
    if (mesh.trailMesh) mesh.trailMesh.position.x = shift;
    labels.push(`${frame}`);
});

const total = move ? move.startup + move.active + move.recovery : '';
document.getElementById('lbl').textContent =
    `${moveId || stateName}  ${move ? `startup ${move.startup} active ${move.active} total ${total}` : ''}\nframes: ${labels.join('  ')}`;
renderer.render(scene, cam);
window.__ready = true;
