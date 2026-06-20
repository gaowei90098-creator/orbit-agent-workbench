import { useEffect, useRef } from 'react'
import { Color, Mesh, Program, Renderer, Triangle } from 'ogl'

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 rampColor = mix(uColorStops[0], uColorStops[1], smoothstep(0.0, 0.58, uv.x));
  rampColor = mix(rampColor, uColorStops[2], smoothstep(0.48, 1.0, uv.x));

  float waveA = snoise(vec2(uv.x * 1.85 + uTime * 0.08, uTime * 0.18)) * 0.42 * uAmplitude;
  float waveB = snoise(vec2(uv.x * 3.2 - uTime * 0.05, uTime * 0.11 + 7.0)) * 0.22 * uAmplitude;
  float height = exp(waveA + waveB);
  float intensity = uv.y * 2.05 - height + 0.46;
  float auroraAlpha = smoothstep(0.18 - uBlend * 0.45, 0.18 + uBlend * 0.52, intensity);
  float fade = smoothstep(0.0, 0.18, uv.y) * (1.0 - smoothstep(0.86, 1.0, uv.y));
  vec3 auroraColor = rampColor * auroraAlpha * fade * 0.82;
  fragColor = vec4(auroraColor, auroraAlpha * fade * 0.58);
}
`

export function OrbitAurora({
  colorStops = ['#65d6ff', '#58d995', '#a78bfa'],
  amplitude = 0.82,
  blend = 0.54,
  speed = 0.72
}: {
  colorStops?: string[]
  amplitude?: number
  blend?: number
  speed?: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const propsRef = useRef({ colorStops, amplitude, blend, speed })
  propsRef.current = { colorStops, amplitude, blend, speed }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new Renderer({ alpha: true, premultipliedAlpha: true, antialias: true })
    const gl = renderer.gl
    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.canvas.style.backgroundColor = 'transparent'
    gl.canvas.style.width = '100%'
    gl.canvas.style.height = '100%'

    const geometry = new Triangle(gl)
    if (geometry.attributes.uv) delete geometry.attributes.uv

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: amplitude },
        uColorStops: { value: colorStops.map(hex => colorToRgb(hex)) },
        uResolution: { value: [host.offsetWidth, host.offsetHeight] },
        uBlend: { value: blend }
      }
    })
    const mesh = new Mesh(gl, { geometry, program })
    host.appendChild(gl.canvas)

    const resize = () => {
      const width = Math.max(1, host.offsetWidth)
      const height = Math.max(1, host.offsetHeight)
      renderer.setSize(width, height)
      program.uniforms.uResolution.value = [width, height]
    }
    window.addEventListener('resize', resize)
    resize()

    let frame = 0
    const update = (time: number) => {
      frame = requestAnimationFrame(update)
      const props = propsRef.current
      program.uniforms.uTime.value = time * 0.001 * props.speed
      program.uniforms.uAmplitude.value = props.amplitude
      program.uniforms.uBlend.value = props.blend
      program.uniforms.uColorStops.value = props.colorStops.map(hex => colorToRgb(hex))
      renderer.render({ scene: mesh })
    }
    frame = requestAnimationFrame(update)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      if (gl.canvas.parentNode === host) host.removeChild(gl.canvas)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  return <div className="orbit-aurora" ref={hostRef} />
}

function colorToRgb(hex: string): [number, number, number] {
  const c = new Color(hex)
  return [c.r, c.g, c.b]
}
