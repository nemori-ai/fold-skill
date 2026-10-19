// pulse 的概念层：粒子云、弧的笔触、辉光、余辉与背景里缓慢流动的结构。它只用灰白，不画文字、数字与朱红；
// 信息层（pulse.mjs）画在它上面。WebGL2 带一层余辉缓冲；拿不到 WebGL2 时退回 Canvas 2D（没有余辉）。
//
// frame(scene) 每帧调用一次，scene 里是 CSS 像素坐标：
//   points: Float32Array，每点 5 个数 [x, y, size, alpha, ring]；pointCount
//   lines:  Float32Array，每个顶点 3 个数 [x, y, alpha]，两两成一段；lineCount（顶点数）
//   duck（整体亮度乘数）、flash（闪光增益）、masks（[x, y, w, h] 数组，信息层文字与面板所在，概念层在这里让开）
//   dt（距上一帧的秒数，决定余辉衰减）、still（为真时不留余辉：减少动态效果或定格）

const BG = [9 / 255, 10 / 255, 11 / 255];
const CAP = 0.62; // 概念层最亮处：低于信息层的字与线（约 0.88）

export function createField(canvas) {
  let gl = null;
  try { gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: false }); } catch { gl = null; }
  return gl ? glField(canvas, gl) : flatField(canvas);
}

// ---------- WebGL2 ----------

function glField(canvas, gl) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const uniforms = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i += 1) {
      const { name } = gl.getActiveUniform(p, i);
      uniforms[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, name);
    }
    return { p, u: uniforms };
  };
  const toClip = `vec2 clip(vec2 p) { return vec2(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0); }`;
  const points = program(`#version 300 es
    in vec2 a_pos; in float a_size; in float a_alpha; in float a_ring;
    uniform vec2 u_res; uniform float u_dpr;
    out float v_alpha; out float v_ring;
    ${toClip}
    void main() {
      gl_Position = vec4(clip(a_pos), 0.0, 1.0);
      gl_PointSize = max(1.0, a_size * u_dpr * 3.2);
      v_alpha = a_alpha; v_ring = a_ring;
    }`, `#version 300 es
    precision mediump float;
    in float v_alpha; in float v_ring;
    out vec4 o;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      float core = v_ring > 0.5 ? smoothstep(0.16, 0.0, abs(d - 0.34)) : smoothstep(0.34, 0.0, d);
      float halo = exp(-d * d * 7.0) * 0.32;
      float a = v_alpha * (core + halo) * step(d, 1.0);
      o = vec4(vec3(0.86, 0.88, 0.9) * a, 1.0);
    }`);
  const lines = program(`#version 300 es
    in vec2 a_pos; in float a_alpha;
    uniform vec2 u_res;
    out float v_alpha;
    ${toClip}
    void main() { gl_Position = vec4(clip(a_pos), 0.0, 1.0); v_alpha = a_alpha; }`, `#version 300 es
    precision mediump float;
    in float v_alpha; out vec4 o;
    void main() { o = vec4(vec3(0.8, 0.83, 0.86) * v_alpha, 1.0); }`);
  const quad = `#version 300 es
    out vec2 v_uv;
    void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); v_uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  const fade = program(quad, `#version 300 es
    precision mediump float;
    in vec2 v_uv; uniform sampler2D u_prev; uniform float u_keep; uniform float u_sub;
    out vec4 o;
    void main() { o = vec4(max(texture(u_prev, v_uv).rgb * u_keep - u_sub, 0.0), 1.0); }`);
  const out = program(quad, `#version 300 es
    precision mediump float;
    in vec2 v_uv; uniform sampler2D u_tex; uniform vec2 u_px; uniform float u_duck; uniform float u_gain;
    uniform vec4 u_masks[6]; uniform int u_maskCount; uniform float u_feather; uniform vec3 u_bg; uniform float u_cap;
    out vec4 o;
    void main() {
      vec3 c = texture(u_tex, v_uv).rgb * u_gain;
      vec3 mapped = u_cap * (1.0 - exp(-c * 1.5));
      vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_px;
      float m = 1.0;
      for (int i = 0; i < 6; i++) {
        if (i >= u_maskCount) break;
        vec4 r = u_masks[i];
        float d = length(max(max(r.xy - p, p - (r.xy + r.zw)), 0.0));
        m *= smoothstep(0.0, u_feather, d);
      }
      o = vec4(u_bg + mapped * m * u_duck, 1.0);
    }`);

  const half = Boolean(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  const targets = [0, 1].map(() => ({ tex: gl.createTexture(), fbo: gl.createFramebuffer() }));
  let width = 0, height = 0, dpr = 1, current = 0, fresh = true;
  function allocate() {
    for (const t of targets) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, half ? gl.RGBA16F : gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fresh = true;
  }

  const pointVAO = gl.createVertexArray(), pointBuf = gl.createBuffer();
  gl.bindVertexArray(pointVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
  [['a_pos', 2, 0], ['a_size', 1, 8], ['a_alpha', 1, 12], ['a_ring', 1, 16]].forEach(([name, size, offset]) => {
    const loc = gl.getAttribLocation(points.p, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 20, offset);
  });
  const lineVAO = gl.createVertexArray(), lineBuf = gl.createBuffer();
  gl.bindVertexArray(lineVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
  [['a_pos', 2, 0], ['a_alpha', 1, 8]].forEach(([name, size, offset]) => {
    const loc = gl.getAttribLocation(lines.p, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 12, offset);
  });
  const emptyVAO = gl.createVertexArray();
  gl.bindVertexArray(null);

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    kind: 'webgl2',
    device: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    resize(w, h, ratio) {
      width = w; height = h; dpr = ratio;
      canvas.width = Math.max(1, Math.round(w * ratio));
      canvas.height = Math.max(1, Math.round(h * ratio));
      allocate();
    },
    clearTrails() { fresh = true; },
    frame(scene) {
      if (!width) return;
      const prev = targets[current], next = targets[1 - current];
      gl.viewport(0, 0, canvas.width, canvas.height);
      // 1. Afterglow: carry the last frame, faded by time, into the next buffer.
      gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
      gl.disable(gl.BLEND);
      if (fresh || scene.still) {
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        fresh = false;
      } else {
        gl.useProgram(fade.p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prev.tex);
        gl.uniform1i(fade.u.u_prev, 0);
        gl.uniform1f(fade.u.u_keep, Math.exp(-Math.min(0.1, scene.dt) / 0.075));
        gl.uniform1f(fade.u.u_sub, half ? 0.0008 : 0.6 / 255);
        gl.bindVertexArray(emptyVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // 2. New light, added.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      if (scene.lineCount) {
        gl.useProgram(lines.p);
        gl.uniform2f(lines.u.u_res, width, height);
        gl.bindVertexArray(lineVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
        gl.bufferData(gl.ARRAY_BUFFER, scene.lines.subarray(0, scene.lineCount * 3), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.LINES, 0, scene.lineCount);
      }
      if (scene.pointCount) {
        gl.useProgram(points.p);
        gl.uniform2f(points.u.u_res, width, height);
        gl.uniform1f(points.u.u_dpr, dpr);
        gl.bindVertexArray(pointVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
        gl.bufferData(gl.ARRAY_BUFFER, scene.points.subarray(0, scene.pointCount * 5), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.POINTS, 0, scene.pointCount);
      }
      // 3. To the screen: capped, ducked, and kept off the information layer's text.
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(out.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, next.tex);
      gl.uniform1i(out.u.u_tex, 0);
      gl.uniform2f(out.u.u_px, canvas.width, canvas.height);
      gl.uniform1f(out.u.u_duck, scene.duck);
      gl.uniform1f(out.u.u_gain, 1 + scene.flash);
      gl.uniform3f(out.u.u_bg, ...BG);
      gl.uniform1f(out.u.u_cap, CAP);
      const masks = (scene.masks || []).slice(0, 6);
      const flat = new Float32Array(24);
      masks.forEach((m, i) => flat.set(m.map(v => v * dpr), i * 4));
      gl.uniform4fv(out.u.u_masks, flat);
      gl.uniform1i(out.u.u_maskCount, masks.length);
      gl.uniform1f(out.u.u_feather, 22 * dpr);
      gl.bindVertexArray(emptyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      current = 1 - current;
    },
  };
}

// ---------- Canvas 2D fallback: the same light without afterglow ----------

function flatField(canvas) {
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0, dpr = 1;
  const rgb = 'rgb(216, 220, 224)';
  return {
    kind: '2d',
    resize(w, h, ratio) {
      width = w; height = h; dpr = ratio;
      canvas.width = Math.max(1, Math.round(w * ratio));
      canvas.height = Math.max(1, Math.round(h * ratio));
    },
    clearTrails() {},
    frame(scene) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgb(${BG.map(v => Math.round(v * 255)).join(',')})`;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      // Same curve as the WebGL tone map, without the afterglow.
      const gain = 1 + scene.flash, toneA = a => CAP * (1 - Math.exp(-1.5 * a * gain)) * scene.duck;
      ctx.strokeStyle = rgb;
      ctx.lineWidth = 0.6;
      for (let i = 0; i + 1 < scene.lineCount; i += 2) {
        const a = scene.lines[i * 3 + 2];
        if (a < 0.004) continue;
        ctx.globalAlpha = Math.min(1, toneA(a));
        ctx.beginPath();
        ctx.moveTo(scene.lines[i * 3], scene.lines[i * 3 + 1]);
        ctx.lineTo(scene.lines[i * 3 + 3], scene.lines[i * 3 + 4]);
        ctx.stroke();
      }
      ctx.fillStyle = rgb;
      for (let i = 0; i < scene.pointCount; i += 1) {
        const a = scene.points[i * 5 + 3];
        if (a < 0.01) continue;
        const s = scene.points[i * 5 + 2];
        ctx.globalAlpha = Math.min(1, toneA(a));
        ctx.fillRect(scene.points[i * 5] - s / 2, scene.points[i * 5 + 1] - s / 2, s, s);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.86;
      ctx.fillStyle = `rgb(${BG.map(v => Math.round(v * 255)).join(',')})`;
      for (const [x, y, w, h] of scene.masks || []) ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
      ctx.globalAlpha = 1;
    },
  };
}
