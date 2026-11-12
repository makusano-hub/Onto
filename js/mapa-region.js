// Carta 3D de la Región de Magallanes: costa real, relieve estilizado, retícula y rótulos.
// La usan la portada (index.html) y la carta de la ontología (grafo.html).
import * as THREE from 'three';
import { GEO } from './region-geo.js';

export const LON0=-71.2, LAT0=-52.6, KX=6, KZ=10;
export const gx = lon => (lon-LON0)*KX, gz = lat => -(lat-LAT0)*KZ;
export const paso = (a,b,v) => { const t=Math.min(1,Math.max(0,(v-a)/(b-a))); return t*t*(3-2*t); };
// Máscara de tierra: 1 = territorio chileno. Se suaviza para que el relieve baje a cero en la costa.
const TIERRA = (() => {
  const {nx,ny,m} = GEO, bin = atob(m), cruda = new Uint8Array(nx*ny); let suave = new Float32Array(nx*ny);
  for(let i=0;i<nx*ny;i++){ cruda[i] = bin.charCodeAt(i>>3)>>(i&7)&1; suave[i]=cruda[i]; }
  for(let v=0;v<3;v++){ const o=new Float32Array(nx*ny);
    for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){ let s=0,c=0;
      for(let b=-1;b<=1;b++) for(let a=-1;a<=1;a++){ const x=i+a,y=j+b; if(x>=0&&y>=0&&x<nx&&y<ny){ s+=suave[y*nx+x]; c++; } }
      o[j*nx+i]=s/c; }
    suave=o; }
  return {cruda, suave};
})();
function costa(lon,lat){            // 0 en el mar y la orilla, 1 tierra adentro
  const {b,dx,dy,nx,ny}=GEO, fx=Math.min(nx-1.001,Math.max(0,(lon-b.w)/dx)), fy=Math.min(ny-1.001,Math.max(0,(b.n-lat)/dy));
  const i=Math.floor(fx), j=Math.floor(fy), u=fx-i, v=fy-j, s=TIERRA.suave, k=j*nx+i;
  return paso(.55,.98, (s[k]*(1-u)+s[k+1]*u)*(1-v) + (s[k+nx]*(1-u)+s[k+nx+1]*u)*v);
}
export function altura(lon,lat){            // relieve estilizado: cordillera al oeste y al sur, estepa al este
  const x=gx(lon), z=gz(lat);
  const n = Math.sin(x*.35+1.3)*Math.cos(z*.31) + .5*Math.sin(x*.9+z*.7) + .25*Math.sin(x*1.9-z*2.3+2);
  const m = Math.max(paso(-71.9,-73.4,lon), .7*paso(-54.2,-54.8,lat)*paso(-66.8,-68.2,lon));
  return costa(lon,lat) * (m*(1.2+2.6*Math.abs(n)) + (1-m)*(.25+.2*n));
}
export const suelo = (x,z) => Math.max(altura(x/KX+LON0, -z/KZ+LAT0), 0);

// Vista que abarca toda la región
export const REGION = {x:0, z:4, R:86};

// Agrega a la escena la tierra, el relieve, la retícula y los rótulos
export function construirRegion(escena){
  const {b:BB, nx:NX, ny:NY} = GEO, W=(BB.e-BB.w)*KX, D=(BB.n-BB.s)*KZ;
  // Tierra: relleno plano y línea de costa, a partir de los polígonos reales
  const capa = (polis, relleno, linea, opLinea) => {
    const mr=new THREE.MeshBasicMaterial({color:relleno}), ml=new THREE.LineBasicMaterial({color:linea, transparent:true, opacity:opLinea});
    polis.forEach(P => {
      const anillo = r => { const v=[]; for(let i=0;i<r.length;i+=2) v.push(new THREE.Vector2(gx(r[i]), -gz(r[i+1]))); return v; };
      const sh=new THREE.Shape(anillo(P[0])); P.slice(1).forEach(hh => sh.holes.push(new THREE.Path(anillo(hh))));
      const g=new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI/2); const me=new THREE.Mesh(g,mr); me.position.y=-.06; escena.add(me);
      P.forEach(r => { const pts=[]; for(let i=0;i<r.length;i+=2) pts.push(new THREE.Vector3(gx(r[i]),.04,gz(r[i+1]))); escena.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), ml)); });
    });
  };
  capa(GEO.ar, 0x0c2440, 0x2f5d87, .9);
  capa(GEO.cl, 0x15395c, 0xbfe3ef, .9);
  // Relieve estilizado, solo sobre tierra chilena
  const P2=2, cx=Math.floor((NX-1)/P2)+1, cy=Math.floor((NY-1)/P2)+1, pos=new Float32Array(cx*cy*3), col=new Float32Array(cx*cy*3), idx=[];
  const bajo=new THREE.Color("#5f7f86"), alto=new THREE.Color("#eaf4f8"), c=new THREE.Color();
  for(let j=0;j<cy;j++) for(let i=0;i<cx;i++){
    const lon=BB.w+i*P2*GEO.dx, lat=BB.n-j*P2*GEO.dy, h=altura(lon,lat), k=(j*cx+i)*3;
    pos[k]=gx(lon); pos[k+1]=h; pos[k+2]=gz(lat); c.copy(bajo).lerp(alto,Math.min(1,Math.max(0,h/3.4))); col[k]=c.r; col[k+1]=c.g; col[k+2]=c.b;
  }
  const enTierra = (i,j) => TIERRA.cruda[j*P2*NX+i*P2]===1;
  for(let j=0;j<cy-1;j++) for(let i=0;i<cx-1;i++){
    const a=j*cx+i, b2=a+1, d=a+cx, e=d+1, A=enTierra(i,j), B2=enTierra(i+1,j), Dd=enTierra(i,j+1), E=enTierra(i+1,j+1);
    if(A&&B2&&Dd) idx.push(a,d,b2); if(B2&&Dd&&E) idx.push(b2,d,e);
  }
  const geo=new THREE.BufferGeometry(); geo.setAttribute("position",new THREE.BufferAttribute(pos,3)); geo.setAttribute("color",new THREE.BufferAttribute(col,3)); geo.setIndex(idx);
  escena.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color:0x15395c, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1})));
  escena.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({wireframe:true, vertexColors:true, transparent:true, opacity:.34})));

  const texto = (t,color="#9fb6ca") => {
    const cv=document.createElement("canvas"); cv.width=512; cv.height=64; const x=cv.getContext("2d");
    x.font="500 30px 'IBM Plex Mono',monospace"; x.fillStyle=color; x.textAlign="center"; x.textBaseline="middle"; x.fillText(t,256,32);
    const tx=new THREE.CanvasTexture(cv); tx.colorSpace=THREE.SRGBColorSpace;
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tx, transparent:true, depthWrite:false})); s.scale.set(14,1.75,1); return s;
  };
  const ret=[], x0=gx(BB.w), x1=gx(BB.e), z0=gz(BB.n), z1=gz(BB.s);
  for(let lat=-49;lat>=-56;lat--){ ret.push(new THREE.Vector3(x0,-.1,gz(lat)), new THREE.Vector3(x1+2,-.1,gz(lat))); const s=texto(Math.abs(lat)+"°S"); s.position.set(x1+5,.2,gz(lat)); escena.add(s); }
  for(let lon=-75;lon<=-67;lon+=2){ ret.push(new THREE.Vector3(gx(lon),-.1,z0), new THREE.Vector3(gx(lon),-.1,z1+2)); const s=texto(Math.abs(lon)+"°O"); s.position.set(gx(lon),.2,z1+4.5); escena.add(s); }
  escena.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ret), new THREE.LineBasicMaterial({color:0x2a5a8a, transparent:true, opacity:.55})));
  [["ESTRECHO DE MAGALLANES",-53.42,-70.5,"#f2b632"],["TIERRA DEL FUEGO",-53.9,-69.6,"#9fb6ca"],["ARGENTINA",-50.6,-69.2,"#4f7396"],["OCÉANO PACÍFICO",-51.6,-75.6,"#4f7396"]]
    .forEach(([t,la,lo,co]) => { const s=texto(t,co); s.position.set(gx(lo),1.4,gz(la)); escena.add(s); });
}
