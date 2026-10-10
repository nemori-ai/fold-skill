import * as THREE from '../vendor/three/three.module.js';

// Material studies, adapted as an original WebGL height-field shader:
// https://tympanus.net/codrops/2024/07/15/how-to-create-a-liquid-raymarching-scene-using-three-js-shading-language/
// https://tympanus.net/codrops/2025/10/25/dissecting-a-wavy-shader-sine-refraction-and-serendipity/
// https://tympanus.net/codrops/2026/09/08/building-an-infinite-liquid-glass-grid-with-three-js-webgpu-and-tsl/
// A continuous distance field supplies both the silhouette and its thickness.
// Normals come from that moving height field, not from a painted spherical dome.
// Wide room/window reflections and refracted ambient color share those normals.
// Only explicit historical merge edges join two separate information surfaces.

export function makeSurface(canvas, limit=24, bridgeLimit=8) {
  canvas.dataset.material='liquid-calm-v5';
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
  const pixelRatio=Math.min(devicePixelRatio||1,innerWidth<760?1.4:1.3);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  const uniforms={
    uResolution:{value:new THREE.Vector2(1,1)},uCount:{value:0},uTime:{value:0},uPixelRatio:{value:pixelRatio},
    uBlobs:{value:Array.from({length:limit},()=>new THREE.Vector4())},
    uScales:{value:Array.from({length:limit},()=>new THREE.Vector2(1,1))},
    uFlows:{value:Array.from({length:limit},()=>new THREE.Vector3())},
    uColors:{value:Array.from({length:limit},()=>new THREE.Color())},
    uFlags:{value:Array.from({length:limit},()=>new THREE.Vector3())},
    uBridgeCount:{value:0},uBridges:{value:Array.from({length:bridgeLimit},()=>new THREE.Vector4())},
    uBridgeColors:{value:Array.from({length:bridgeLimit},()=>new THREE.Vector4())},
    uPaper:{value:new THREE.Color('#f6f8f5')},
  };
  const fragmentShader=`
    precision highp float;
    varying vec2 vUv;
    uniform vec2 uResolution;
    uniform int uCount;
    uniform vec4 uBlobs[${limit}];
    uniform vec2 uScales[${limit}];
    uniform vec3 uFlows[${limit}];
    uniform vec3 uColors[${limit}];
    uniform vec3 uFlags[${limit}];
    uniform int uBridgeCount;
    uniform vec4 uBridges[${bridgeLimit}];
    uniform vec4 uBridgeColors[${bridgeLimit}];
    uniform float uTime;
    uniform float uPixelRatio;
    uniform vec3 uPaper;

    float smin(float a,float b,float k) {
      float h=max(k-abs(a-b),0.0)/max(k,.001);
      return min(a,b)-h*h*k*.25;
    }
    float surfaceDistance(vec2 p,vec4 b,vec2 scale,vec3 flow) {
      vec2 q=(p-b.xy)/scale;
      vec2 lag=flow.xy/scale;
      float lagLength=length(lag);
      vec2 direction=lag/max(lagLength,.001);
      // The trailing side yields later than the anchor. Stretch releases into
      // a damped travelling wave, while the HTML reading anchor stays stable.
      float trailing=pow(clamp(dot(q,direction)/max(b.z,1.0),0.0,1.2),1.7);
      q-=lag*trailing;
      float c=cos(b.w*.29),s=sin(b.w*.29);
      q=mat2(c,-s,s,c)*q;
      vec2 uv=q/vec2(b.z*1.035,b.z*.965);
      float a=atan(uv.y,uv.x);
      float breath=.046*sin(2.0*a+b.w+uTime*.65)
                  +.024*sin(3.0*a-b.w*.72-uTime*.87)
                  +.012*sin(5.0*a+b.w*.4+uTime*.43);
      breath+=flow.z*.035*sin(3.0*a-uTime*3.0+b.w);
      return (length(uv)-(.975+breath))*b.z*.965;
    }
    float neckDistance(vec2 p,vec2 a,vec2 b,float radius) {
      vec2 delta=b-a;
      float along=clamp(dot(p-a,delta)/max(dot(delta,delta),.001),0.0,1.0);
      float middle=sin(along*3.14159265);
      // The neck is wider where it rejoins a body and thinner at its waist.
      float width=radius*(1.0+.5*(1.0-middle));
      return length(p-a-delta*along)-width;
    }
    vec3 room(vec3 direction) {
      float sky=smoothstep(-.7,.75,direction.y);
      vec3 ambient=mix(vec3(.24,.32,.28),vec3(.76,.85,.83),sky);
      // A long, soft window sweeps across the deformed normals. Its reflected
      // edge bends with the water; it never paints a fixed white dot on it.
      float window=exp(-pow((direction.x+.36+direction.y*.21)/.255,2.0)
                      -pow((direction.y-.28)/.87,4.0));
      float second=exp(-pow((direction.x-.8)/.85,2.0)-pow((direction.y+.08)/.8,2.0));
      ambient=mix(ambient,vec3(1.07,1.06,1.02),window*.94);
      return mix(ambient,vec3(.83,.86,.92),second*.18);
    }
    vec3 ground(vec2 p) {
      vec2 uv=p/max(uResolution,vec2(1.0));
      float daylight=.024*sin(uv.x*5.5+uv.y*1.8)+.014*cos(uv.y*7.0-uv.x*2.2);
      return uPaper*(1.0+daylight);
    }
    float windowReflection(vec3 ray) {
      float narrow=exp(-pow((ray.x+ray.y*.22+.33)/.16,4.0)
                       -pow((ray.y-.25)/.86,4.0));
      float broad=exp(-pow((ray.x+ray.y*.17+.10)/.5,2.0)
                      -pow((ray.y-.3)/.86,4.0));
      return narrow*.83+broad*.17;
    }
    void main() {
      vec2 p=vUv*uResolution;
      float d=100000.0,coverage=0.0,opacity=0.0,selected=0.0,hovered=0.0,heightField=0.0;
      vec2 liquidUV=vec2(0.0);
      float liquidPhase=0.0;
      vec3 pigment=vec3(.5);
      for(int i=0;i<${limit};i++) {
        if(i>=uCount)break;
        if(uBlobs[i].z<.5||uFlags[i].x<.003)continue;
        float di=surfaceDistance(p,uBlobs[i],uScales[i],uFlows[i]);
        float depth=clamp(-di/max(uBlobs[i].z*.975,1.0),0.0,1.0);
        float localHeight=clamp(uBlobs[i].z*.36,11.0,48.0)*sqrt(depth*(2.0-depth))*smoothstep(0.0,3.0,-di);
        vec2 localUV=(p-uBlobs[i].xy)/(uScales[i]*uBlobs[i].z);
        if(localHeight>.001)heightField=-smin(-heightField,-localHeight,3.5);
        coverage=max(coverage,(1.0-smoothstep(-.65,1.0,di))*uFlags[i].x);
        if(di<d){d=di;pigment=uColors[i];opacity=uFlags[i].x;selected=uFlags[i].y;hovered=uFlags[i].z;liquidUV=localUV;liquidPhase=uBlobs[i].w;}
      }
      for(int i=0;i<${bridgeLimit};i++) {
        if(i>=uBridgeCount)break;
        float width=uBridgeColors[i].w;
        if(width<.3)continue;
        float neck=neckDistance(p,uBridges[i].xy,uBridges[i].zw,width);
        float neckDepth=clamp(-neck/max(width,1.0),0.0,1.0);
        float neckHeight=min(width*1.1,24.0)*sqrt(neckDepth*(2.0-neckDepth))*smoothstep(0.0,3.0,-neck);
        if(neckHeight>.001)heightField=-smin(-heightField,-neckHeight,6.0);
        if(neck<d){pigment=uBridgeColors[i].xyz;opacity=1.0;selected=0.0;hovered=0.0;}
        d=smin(d,neck,clamp(width*2.2,8.0,45.0));
        coverage=max(coverage,1.0-smoothstep(-.65,1.0,d));
      }
      if(d>34.0)discard;

      float inside=max(-d,0.0);
      float cap=clamp(heightField/42.0,0.0,1.0);
      float height=heightField;
      // Two slow, crossing currents change the surface slope continuously.
      float current=sin(p.x*.018+p.y*.009-uTime*.78)
                   *sin(p.y*.016-p.x*.004+uTime*.53);
      height+=current*(3.8+selected*2.0)*cap*cap;
      vec3 normal=normalize(vec3(-dFdx(height)*uPixelRatio,-dFdy(height)*uPixelRatio,1.0));
      vec3 view=vec3(0.0,0.0,1.0);
      vec3 bent=refract(-view,normal,1.0/1.36);
      vec2 through=p+bent.xy*(height+13.0)*2.7;
      // Clear tinted transmission carries the pigment; the room contributes
      // mainly at grazing angles, so it cannot wash every drop into gray.
      vec3 transmitted=mix(ground(through),pigment,.31+cap*.24);
      // Looking into the selected drop reveals a denser, coloured meniscus.
      // The dye flows around a quiet reading centre; it is not a closed rim.
      vec2 lens=liquidUV+normal.xy*.14;
      float drift=.055*sin(lens.y*3.2+uTime*.43+liquidPhase);
      float dyeFold=.5+.5*sin(lens.x*3.1-lens.y*2.0
                             +sin(lens.y*3.3+uTime*.24+liquidPhase)*.7);
      float quietCentre=smoothstep(.20,.76,length(lens));
      float lowerPool=smoothstep(-.38,.55,lens.x*.65-lens.y*.85+drift);
      float concentration=.10+quietCentre*(.24+.36*lowerPool+.12*dyeFold);
      vec3 dyedLight=ground(through)*exp(-(vec3(1.0)-pigment)*(.40+concentration*1.35));
      transmitted=mix(transmitted,dyedLight,selected*.92);
      vec3 reflectedRay=reflect(-view,normal);
      vec3 reflected=room(reflectedRay);
      float fresnel=.045+.72*pow(1.0-max(normal.z,0.0),2.5);
      vec3 color=mix(transmitted,reflected,.055+fresnel*.28);
      float window=windowReflection(reflectedRay)*smoothstep(3.0,10.0,inside);
      float readingClearance=smoothstep(.30,.66,length(liquidUV));
      color=mix(color,vec3(1.03,1.04,1.01),window*(.32+hovered*.14+selected*.15*readingClearance));
      // Wide transmitted light: follows the moving slope, with no fixed spot
      // and no hard concentric rim. A selected surface deepens organically.
      float sideTransmission=pow(1.0-max(normal.z,0.0),.7)*max(normal.x*.6-normal.y*.3,0.0);
      color=mix(color,mix(uPaper,pigment,.72),sideTransmission*.22);
      float edgeShade=exp(-inside/6.5)*.065;
      color*=1.0-edgeShade;
      // A curved sheet of daylight is refracted through the upper-left side.
      // The opposite coloured fold gives depth. Neither follows the perimeter.
      float lightAxis=lens.x*.72-lens.y*.69;
      float crossAxis=lens.x*.69+lens.y*.72;
      float bentAxis=lightAxis+.19*sin(crossAxis*2.4+liquidPhase*.35+uTime*.22)
                     +normal.x*.13;
      float lightFold=exp(-pow((bentAxis+.48)/.105,2.0))
                      *exp(-pow((crossAxis-.05)/.83,4.0));
      float lightShoulder=exp(-pow((bentAxis+.35)/.27,2.0))
                          *smoothstep(.24,.72,length(lens));
      float deepFold=exp(-pow((bentAxis-.58)/.17,2.0))
                     *exp(-pow((crossAxis+.10)/.82,4.0));
      float innerMask=smoothstep(2.0,15.0,inside);
      color=mix(color,mix(pigment,uPaper,.18),deepFold*innerMask*selected*.26);
      color=mix(color,vec3(1.04,1.055,1.03),
                (lightFold*.62+lightShoulder*.16)*innerMask*selected*readingClearance);

      float shadow=exp(-max(d,0.0)/8.5)*.11*opacity;
      float alpha=coverage+shadow*(1.0-coverage);
      vec3 result=mix(vec3(.48,.56,.50),color,coverage/max(alpha,.001));
      gl_FragColor=vec4(result,alpha);
      #include <colorspace_fragment>
    }`;
  const geometry=new THREE.PlaneGeometry(2,2);
  const material=new THREE.ShaderMaterial({uniforms,fragmentShader,
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}',
    transparent:true,depthTest:false,depthWrite:false});
  const scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));
  const camera=new THREE.Camera();
  const color=new THREE.Color();
  let height=1;
  let previousTime=null;
  const focus=new Map();
  const phase=id=>[...String(id)].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,17)%628/100;
  return {
    resize(w,h){height=h;renderer.setSize(w,h,false);uniforms.uResolution.value.set(w,h);},
    draw(bodies,bridges,selected,hover,time,{reducedMotion=false}={}){
      const active=bodies.filter(b=>b.r>.5&&b.opacity>.003).slice(0,limit);
      const delta=previousTime===null?0:Math.max(0,Math.min(time-previousTime,.08));
      const blend=reducedMotion?1:1-Math.exp(-delta/.20);
      // Slow only the continuous liquid motion, keeping selection responsive.
      uniforms.uCount.value=active.length;uniforms.uTime.value=time*.4;
      active.forEach((b,i)=>{
        let f=focus.get(b.id);
        if(!f){f={selected:b.id===selected?1:0,hover:0};focus.set(b.id,f);}
        f.selected+=(Number(b.id===selected)-f.selected)*blend;
        f.hover+=(Number(b.id===hover&&b.id!==selected)-f.hover)*blend;
        uniforms.uBlobs.value[i].set(b.x,height-b.y,b.r,phase(b.id));
        uniforms.uScales.value[i].set(b.stretch||1,1);
        uniforms.uFlows.value[i].set(b.flowX||0,-(b.flowY||0),b.strain||0);
        uniforms.uColors.value[i].set(b.color);
        uniforms.uFlags.value[i].set(b.opacity,f.selected,f.hover);
      });
      previousTime=time;
      const lines=bridges.filter(b=>b.width>.3).slice(0,bridgeLimit);
      uniforms.uBridgeCount.value=lines.length;
      lines.forEach((b,i)=>{uniforms.uBridges.value[i].set(b.a.x,height-b.a.y,b.b.x,height-b.b.y);color.set(b.color);uniforms.uBridgeColors.value[i].set(color.r,color.g,color.b,b.width);});
      renderer.render(scene,camera);
    },
    dispose(){geometry.dispose();material.dispose();renderer.dispose();},
  };
}
