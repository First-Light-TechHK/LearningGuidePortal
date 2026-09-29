"use client";

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Rotate3D } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { lessonMessages, type LessonLocale } from '@/messages/lesson-authoring';
import './lesson-authoring.css';

function disposeObject(root: THREE.Object3D) {
  const resources = new Set<{ dispose: () => void }>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) resources.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
      resources.add(material);
      Object.values(material).forEach(value => { if (value instanceof THREE.Texture) { resources.add(value); if (typeof ImageBitmap !== 'undefined' && value.image instanceof ImageBitmap) value.image.close(); } });
    }
  });
  resources.forEach(resource => resource.dispose());
}

export function CourseModelPreview({ url, title = '', locale }: { url: string; title?: string; locale: LessonLocale }) {
  const host = useRef<HTMLDivElement>(null), actions = useRef<{ reset: () => void; rotate: (value: boolean) => void } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'), [rotating, setRotating] = useState(false);
  const t = lessonMessages(locale);
  useEffect(() => {
    if (!host.current) return; const container: HTMLDivElement = host.current;
    const abort = new AbortController(); let disposed = false, renderer: THREE.WebGLRenderer | undefined, controls: OrbitControls | undefined;
    let frame = 0, observer: ResizeObserver | undefined, model: THREE.Object3D | undefined, mixer: THREE.AnimationMixer | undefined;
    setState('loading'); setRotating(false);
    async function start() {
      try {
        if (!(/^\/(?!\/)/.test(url) || /^https:\/\//.test(url)) || /[\u0000-\u0020\\]/.test(url)) throw new Error('url');
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setClearColor(0xf3f6f5); renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.setAttribute('aria-label', title || t.model3d); renderer.domElement.tabIndex = 0;
        container.appendChild(renderer.domElement);
        const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x61736e, 2.4));
        const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(4, 6, 5); scene.add(light);
        controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.listenToKeyEvents(renderer.domElement);
        const resize = () => { if (!renderer) return; const width = container.clientWidth, height = container.clientHeight; renderer.setSize(width, height); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix(); };
        observer = new ResizeObserver(resize); observer.observe(container); resize();
        const response = await fetch(url, { signal: abort.signal }); if (!response.ok) throw new Error('fetch');
        if (Number(response.headers.get('content-length')) > 50 * 1024 * 1024) throw new Error('size');
        const buffer = await response.arrayBuffer(); if (disposed) return;
        if (buffer.byteLength > 50 * 1024 * 1024) throw new Error('size');
        if (buffer.byteLength >= 12 && new DataView(buffer).getUint32(0, true) === 0x46546c67) {
          const manager = new THREE.LoadingManager();
          manager.setURLModifier(path => { if (/^(blob:|data:)/.test(path)) return path; throw new Error('external-model-resource'); });
          const gltf = await new GLTFLoader(manager).parseAsync(buffer, ''); model = gltf.scene;
          if (gltf.animations.length) { mixer = new THREE.AnimationMixer(model); gltf.animations.forEach(clip => mixer!.clipAction(clip).play()); }
        } else {
          const source = new TextDecoder().decode(buffer);
          if (!/^v\s+[-.\d]/m.test(source) || !/^f\s+/m.test(source)) throw new Error('format');
          model = new OBJLoader().parse(source);
          model.traverse(object => { if (object instanceof THREE.Mesh) { (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); object.material = new THREE.MeshStandardMaterial({ color: 0x208b80, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide }); } });
        }
        if (disposed) { disposeObject(model); return; }
        const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
        const extent = Math.max(size.x, size.y, size.z); if (!Number.isFinite(extent) || extent <= 0) throw new Error('empty');
        model.position.sub(centre); model.scale.multiplyScalar(2 / extent); model.position.multiplyScalar(2 / extent); scene.add(model);
        const reset = () => { const distance = 1.8 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect); camera.position.set(distance * 0.7, distance * 0.4, distance); controls!.target.set(0, 0, 0); controls!.update(); };
        actions.current = { reset, rotate: value => { if (controls) controls.autoRotate = value; } }; reset();
        const clock = new THREE.Clock();
        const draw = () => { if (disposed) return; frame = requestAnimationFrame(draw); mixer?.update(Math.min(clock.getDelta(), 0.1)); controls!.update(); renderer!.render(scene, camera); };
        draw(); setState('ready');
      } catch { if (!disposed) setState('error'); }
    }
    void start();
    return () => { disposed = true; abort.abort(); cancelAnimationFrame(frame); observer?.disconnect(); controls?.dispose(); mixer?.stopAllAction(); if (model) { mixer?.uncacheRoot(model); disposeObject(model); } renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove(); actions.current = null; };
  }, [url, title, t.model3d]);
  return <div className="la-model la"><div ref={host} className="la-model-canvas"/>{state !== 'ready' && <p className="la-model-status" role={state === 'error' ? 'alert' : 'status'}>{state === 'error' ? t.unsupportedModel : t.loading}</p>}<div className="la-model-tools"><button type="button" className="la-icon" title={t.resetView} aria-label={t.resetView} disabled={state !== 'ready'} onClick={() => actions.current?.reset()}><RotateCcw size={18}/></button><button type="button" className="la-icon" title={t.rotate} aria-label={t.rotate} aria-pressed={rotating} disabled={state !== 'ready'} onClick={() => { actions.current?.rotate(!rotating); setRotating(!rotating); }}><Rotate3D size={18}/></button></div></div>;
}
