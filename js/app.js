// Diese Datei optional einbinden NACH app.js.
// Fügt einfache Light/Exposure Controls hinzu.
(function(){
  function createControls(){
    const sidebar = document.getElementById('sidebar');
    if(!sidebar) return;
    const wrapper = document.createElement('section');
    wrapper.style.marginTop = '20px';
    wrapper.innerHTML = `
      <h2>Viewport Licht</h2>
      <label style="display:block;font-size:12px;color:var(--text-muted)">Exposure
        <input id="exp-slider" type="range" min="0.5" max="3" step="0.05" value="1.6">
      </label>
      <label style="display:block;font-size:12px;color:var(--text-muted)">Key Intensity
        <input id="key-slider" type="range" min="0.2" max="3" step="0.05" value="1.6">
      </label>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
        <button id="btnEnvToggle" type="button">Environment AN</button>
        <button id="btnAutoBright" type="button">Auto Brighten</button>
        <button id="btnDisableVCols" type="button">VertexColors aus</button>
        <button id="btnBasicPreview" type="button">Basic Preview</button>
      </div>
    `;
    sidebar.appendChild(wrapper);

    const exp = wrapper.querySelector('#exp-slider');
    const key = wrapper.querySelector('#key-slider');
    const btnEnv = wrapper.querySelector('#btnEnvToggle');
    const btnBright = wrapper.querySelector('#btnAutoBright');
    const btnVCols = wrapper.querySelector('#btnDisableVCols');
    const btnBasic = wrapper.querySelector('#btnBasicPreview');

    let envOn = false;
    let basicOn = false;

    exp.addEventListener('input', ()=>{
      window.sceneManager?.setExposure(parseFloat(exp.value));
    });
    key.addEventListener('input', ()=>{
      window.sceneManager?.setLightIntensities({ key: parseFloat(key.value) });
    });
    btnEnv.addEventListener('click', ()=>{
      envOn = !envOn;
      window.sceneManager?.enableEnvironment(envOn);
      btnEnv.textContent = envOn ? 'Environment AUS' : 'Environment AN';
    });
    btnBright.addEventListener('click', ()=>{
      window.sceneManager?.autoBrightenSelected(0.4);
    });
    btnVCols.addEventListener('click', ()=>{
      window.sceneManager?.disableVertexColorsInSelected();
    });
    btnBasic.addEventListener('click', ()=>{
      basicOn = !basicOn;
      window.sceneManager?.previewBasicMode(basicOn);
      btnBasic.textContent = basicOn ? 'Basic Off' : 'Basic Preview';
    });
  }
  window.addEventListener('DOMContentLoaded', createControls);
})();
