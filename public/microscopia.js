// ===== MICROSCOPIA VIRTUAL COM PACIENTES =====

let currentMicroPatient = null;

function hasRegisteredHealingData(patient) {
  if (!patient || !USE_API) return false;

  const hasProgress = getEffectiveHealProgress(patient) > 0;
  const hasHistory = Array.isArray(patient.history) && patient.history.some(entry => typeof entry.pct === 'number');

  return hasProgress && hasHistory;
}

// Renderizar seletor de pacientes para microscopia
function renderMicroPatientSelector() {
  const container = document.getElementById('mps-cards');
  if (!container) return;

  const availablePatients = (patients || []).filter(hasRegisteredHealingData);
  if (availablePatients.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;color:var(--gray400);padding:2rem">
        🔒 Nenhum paciente com cicatrização registrada no servidor. Salve um resultado de evolução para liberar a microscopia.
      </div>`;
    return;
  }

  container.innerHTML = availablePatients.map((p) => {
    const efic = calcEficacia(p);
    const ini = (p.nome?.split(' ')[0]?.[0] || '?') + (p.nome?.split(' ')[1]?.[0] || '');
    const riscoTagClass = efic < 0.3 ? 'high-risk' : efic < 0.6 ? 'medium-risk' : 'low-risk';
    const riscoLabel = efic < 0.3 ? 'Alto' : efic < 0.6 ? 'Médio' : 'Baixo';
    
    return `
    <div class="mps-card" onclick="selectMicroPatient('${p.id}')">
      <div class="mps-avatar">${ini.toUpperCase()}</div>
      <div class="mps-name">${p.nome}</div>
      <div class="mps-tags">
        <span class="mps-tag">W${p.wagner || 0}</span>
        <span class="mps-tag ${riscoTagClass}">${riscoLabel}</span>
      </div>
    </div>`;
  }).join('');
}

// Selecionar paciente para análise microscópica
function selectMicroPatient(id) {
  const rawPatient = patients.find(p => String(p.id) === String(id));
  if (!rawPatient) return;

  if (!hasRegisteredHealingData(rawPatient)) {
    showToast('🔒 Microscopia disponível somente para pacientes com cicatrização registrada no servidor.', 'warn');
    return;
  }

  currentMicroPatient = rawPatient;

  // Esconder seletor, mostrar info do paciente
  document.getElementById('mps-cards').closest('.micro-patient-selector').style.display = 'none';
  const info = document.getElementById('micro-patient-info');
  info.style.display = 'block';

  // Preencher dados
  const ini = (rawPatient.nome?.split(' ')[0]?.[0] || '?') + (rawPatient.nome?.split(' ')[1]?.[0] || '');
  document.getElementById('micro-pp-avatar').textContent = ini.toUpperCase();
  document.getElementById('micro-pp-name').textContent = rawPatient.nome;
  
  const efic = calcEficacia(rawPatient);
  const details = `Wagner ${rawPatient.wagner || 0} · HbA1c ${rawPatient.hba1c || 0}% · ${rawPatient.idade || 0} anos`;
  document.getElementById('micro-pp-details').textContent = details;

  // Desbloquear microscópio
  const body = document.getElementById('micro-body');
  const overlay = document.getElementById('micro-lock-overlay');
  if (body) body.classList.remove('micro-body-locked');
  if (overlay) overlay.style.display = 'none';

  // Verificar se há dados de simulação para este paciente
  let latestSimulation = null;
  if (rawPatient.history && rawPatient.history.length > 0) {
    // Procurar pela última entrada de simulação
    for (let i = rawPatient.history.length - 1; i >= 0; i--) {
      if (rawPatient.history[i].type === 'simulation' && rawPatient.history[i].simulationResults) {
        latestSimulation = rawPatient.history[i].simulationResults;
        break;
      }
    }
  }

  // Desenhar microscopia
  if (latestSimulation) {
    // Usar dados da simulação
    drawMicroscopyFromSimulation(rawPatient, latestSimulation);
    showToast(`🔬 Análise de ${rawPatient.nome} — Dados da simulação (Dia ${latestSimulation.day}) — Eficácia: ${Math.round(latestSimulation.efficacy * 100)}%`);
  } else {
    // Usar cálculo padrão de eficácia
    drawMicroscopyComparison(rawPatient, efic);
    showToast(`🔬 Análise de ${rawPatient.nome} — Eficácia esperada: ${Math.round(efic * 100)}%`);
  }
}

// Desenhar microscopia usando dados da simulação
function drawMicroscopyFromSimulation(patient, simulationData) {
  const canvasBefore = document.getElementById('micro-canvas-before');
  const canvasAfter = document.getElementById('micro-canvas-after');
  
  if (!canvasBefore || !canvasAfter) return;

  const ctxBefore = canvasBefore.getContext('2d');
  const ctxAfter = canvasAfter.getContext('2d');

  canvasBefore.width = 360;
  canvasBefore.height = 280;
  canvasAfter.width = 360;
  canvasAfter.height = 280;

  // Desenhar ANTES (sem tratamento) baseado nos dados da simulação
  drawMicroscopicViewFromData(ctxBefore, canvasBefore.width, canvasBefore.height, simulationData.untreated, false);

  // Desenhar DEPOIS (com tratamento) baseado nos dados da simulação
  drawMicroscopicViewFromData(ctxAfter, canvasAfter.width, canvasAfter.height, simulationData.treated, true);
  
  // Renderizar informações da simulação
  const infoEl = document.getElementById('micro-simulation-info');
  if (infoEl) {
    infoEl.innerHTML = `
      <div style="font-size:.8rem;color:#666;line-height:1.8">
        <div><strong>📊 Simulação Dia ${simulationData.day}</strong></div>
        <div>Cicatrização: ${simulationData.treated.healing}% (vs ${simulationData.untreated.healing}% sem trat.)</div>
        <div>Controle bacteriano: ${simulationData.treated.bacteriaCtrl}%</div>
      </div>`;
  }
}

// Limpar seleção e voltar ao seletor
function clearMicroPatient() {
  currentMicroPatient = null;
  document.getElementById('mps-cards').closest('.micro-patient-selector').style.display = 'block';
  document.getElementById('micro-patient-info').style.display = 'none';
  const body = document.getElementById('micro-body');
  const overlay = document.getElementById('micro-lock-overlay');
  if (body) body.classList.add('micro-body-locked');
  if (overlay) overlay.style.display = 'flex';
}

// Desenhar comparação antes/depois baseada na eficácia do paciente
function drawMicroscopyComparison(patient, efficacy) {
  const canvasBefore = document.getElementById('micro-canvas-before');
  const canvasAfter = document.getElementById('micro-canvas-after');
  
  if (!canvasBefore || !canvasAfter) return;

  const ctxBefore = canvasBefore.getContext('2d');
  const ctxAfter = canvasAfter.getContext('2d');

  // Limpar canvas
  canvasBefore.width = 360;
  canvasBefore.height = 280;
  canvasAfter.width = 360;
  canvasAfter.height = 280;

  // Desenhar ANTES (sem tratamento)
  drawMicroscopicView(ctxBefore, canvasBefore.width, canvasBefore.height, 'before', efficacy);

  // Desenhar DEPOIS (com tratamento)
  drawMicroscopicView(ctxAfter, canvasAfter.width, canvasAfter.height, 'after', efficacy);

  // Atualizar métricas
  updateMicroscopyMetrics(efficacy);
}

// Desenhar vista microscópica (antes ou depois)
function drawMicroscopicView(ctx, w, h, mode, efficacy) {
  // Fundo
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, '#0a1628');
  gradient.addColorStop(1, '#132a4e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  // Grid de fundo (representando estrutura tisular)
  ctx.strokeStyle = 'rgba(0,180,160,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= w; i += 40) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, h);
    ctx.stroke();
  }
  for (let i = 0; i <= h; i += 40) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(w, i);
    ctx.stroke();
  }

  if (mode === 'before') {
    drawBeforeTreatment(ctx, w, h, efficacy);
  } else {
    drawAfterTreatment(ctx, w, h, efficacy);
  }
}

// ANTES: Biofilme bacteriano, inflamação
function drawBeforeTreatment(ctx, w, h, efficacy) {
  const W = w, H = h;

  // Células epiteliais (queratinócitos) - danificadas
  const cellCount = 12;
  for (let i = 0; i < cellCount; i++) {
    const x = 30 + Math.random() * (W - 60);
    const y = 30 + Math.random() * (H - 60);
    const r = 16 + Math.random() * 8;

    // Célula com apoptose (morte)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(200, 50, 50, 0.6)');
    g.addColorStop(1, 'rgba(100, 20, 20, 0.3)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - r, y - r, r * 2, r * 2);
  }

  // Bactérias S. aureus - MUITAS (80% da área)
  const bacteriaCount = 35 + Math.floor(efficacy * -10); // Mais bactérias se eficácia baixa
  for (let i = 0; i < bacteriaCount; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = 3 + Math.random() * 2;

    // Cocos purple/red
    const g = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, r);
    g.addColorStop(0, 'rgba(219, 39, 119, 1)');
    g.addColorStop(1, 'rgba(139, 20, 70, 0.8)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Halo bacteriano
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Biofilme - camada visível
  ctx.fillStyle = 'rgba(200, 100, 100, 0.3)';
  ctx.fillRect(0, H * 0.6, W, H * 0.4);
  ctx.fillStyle = 'rgba(150, 80, 80, 0.2)';
  for (let i = 0; i < 20; i++) {
    ctx.fillRect(Math.random() * W, H * 0.6 + Math.random() * (H * 0.4), 20, 4);
  }

  // Neutrófilos INATIVOS (muito poucos)
  for (let i = 0; i < 2; i++) {
    const x = 50 + Math.random() * (W - 100);
    const y = 50 + Math.random() * (H - 100);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.4)';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// DEPOIS: Controle bacteriano, cicatrização ativa
function drawAfterTreatment(ctx, w, h, efficacy) {
  const W = w, H = h;

  // Células epiteliais - SAUDÁVEIS
  const cellCount = 14;
  for (let i = 0; i < cellCount; i++) {
    const x = 30 + Math.random() * (W - 60);
    const y = 30 + Math.random() * (H - 60);
    const r = 16 + Math.random() * 8;

    // Célula recuperando
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0, 180, 160, 0.7)');
    g.addColorStop(1, 'rgba(0, 150, 140, 0.3)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.strokeStyle = 'rgba(0, 180, 160, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - r, y - r, r * 2, r * 2);
  }

  // Bactérias - POUCAS e MORTAS (20-30% da quantidade anterior)
  const bacteriaCount = Math.floor((10 + efficacy * 10)); // Menos com melhor eficácia
  for (let i = 0; i < bacteriaCount; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = 2 + Math.random() * 1.5;

    // Bactérias decoloradas/mortas
    const g = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, r);
    g.addColorStop(0, 'rgba(100, 100, 100, 0.5)');
    g.addColorStop(1, 'rgba(50, 50, 50, 0.2)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(100, 100, 100, 0.2)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Taninos (moléculas do barbatimão) - Verde/Azul
  const taninoCount = 15 + Math.floor(efficacy * 20);
  for (let i = 0; i < taninoCount; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    ctx.fillStyle = `rgba(34, 197, 94, ${0.3 + Math.random() * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, 2 + Math.random() * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Neutrófilos ATIVOS (muitos!)
  const neutroCount = 8 + Math.floor(efficacy * 5);
  for (let i = 0; i < neutroCount; i++) {
    const x = 30 + Math.random() * (W - 60);
    const y = 30 + Math.random() * (H - 60);

    // Célula imune ativa
    const g = ctx.createRadialGradient(x - 2, y - 2, 0, x, y, 6);
    g.addColorStop(0, 'rgba(59, 130, 246, 0.9)');
    g.addColorStop(1, 'rgba(29, 78, 216, 0.5)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Halo de atividade
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Nenhum biofilme visível - área limpa
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(W * 0.1, H * 0.6, W * 0.8, H * 0.3);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(34, 197, 94, 0.08)';
  ctx.fillRect(W * 0.1, H * 0.6, W * 0.8, H * 0.3);

  // Texto: "Cicatrização ativa"
  ctx.fillStyle = 'rgba(34, 197, 94, 0.5)';
  ctx.font = 'bold 11px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Área de cicatrização', W * 0.5, H * 0.75);
}

// Atualizar métricas baseadas na eficácia
function updateMicroscopyMetrics(efficacy) {
  // Densidade bacteriana: alta sem trat (85%), baixa com trat (20%)
  const bacteriaBeforeVal = 85;
  const bacteriaAfterVal = Math.max(20, 85 - efficacy * 70);

  document.getElementById('mrt-bact-before').style.width = bacteriaBeforeVal + '%';
  document.getElementById('mrt-bact-before-val').textContent = bacteriaBeforeVal + '%';

  document.getElementById('mrt-bact-after').style.width = bacteriaAfterVal + '%';
  document.getElementById('mrt-bact-after-val').textContent = Math.round(bacteriaAfterVal) + '%';

  // Biofilme: alto sem trat (80%), baixo com trat (15%)
  const biofilmBeforeVal = 80;
  const biofilmAfterVal = Math.max(15, 80 - efficacy * 65);

  document.getElementById('mrt-biofilm-before').style.width = biofilmBeforeVal + '%';
  document.getElementById('mrt-biofilm-before-val').textContent = biofilmBeforeVal + '%';

  document.getElementById('mrt-biofilm-after').style.width = biofilmAfterVal + '%';
  document.getElementById('mrt-biofilm-after-val').textContent = Math.round(biofilmAfterVal) + '%';

  // Cicatrização: baixa sem trat (5%), alta com trat (65-80%)
  const healBeforeVal = 5;
  const healAfterVal = Math.max(60, Math.min(80, 20 + efficacy * 60));

  document.getElementById('mrt-heal-before').style.width = healBeforeVal + '%';
  document.getElementById('mrt-heal-before-val').textContent = healBeforeVal + '%';

  document.getElementById('mrt-heal-after').style.width = healAfterVal + '%';
  document.getElementById('mrt-heal-after-val').textContent = Math.round(healAfterVal) + '%';
}

// Inicializar microscopia quando aba for ativada
function initMicroscopyTab() {
  if (document.getElementById('lab-microscopia').classList.contains('active')) {
    renderMicroPatientSelector();
  }
}

// ===== DESENHAR MICROSCOPIA A PARTIR DOS DADOS DA SIMULAÇÃO =====
function drawMicroscopicViewFromData(ctx, w, h, simulationData, treated) {
  // Fundo
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  if (treated) {
    gradient.addColorStop(0, '#0a1f12');
    gradient.addColorStop(1, '#051008');
  } else {
    gradient.addColorStop(0, '#1a0808');
    gradient.addColorStop(1, '#0d0404');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  // Grid de fundo
  ctx.strokeStyle = treated ? 'rgba(0,200,100,0.05)' : 'rgba(200,50,50,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= w; i += 40) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, h);
    ctx.stroke();
  }
  for (let i = 0; i <= h; i += 40) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(w, i);
    ctx.stroke();
  }

  const W = w, H = h;
  // Usar woundSize como seed para consistência visual
  const seed = simulationData.woundSize || 50;
  
  if (!treated) {
    // ===== SEM TRATAMENTO =====
    // Células epiteliais danificadas
    const cellCount = 8;
    for (let i = 0; i < cellCount; i++) {
      const x = 30 + ((i * 47 + seed * 11) % (W - 60));
      const y = 30 + ((i * 73 + seed * 17) % (H - 60));
      const r = 14 + ((i * 11 + seed * 7) % 8);
      
      // Célula com apoptose (morte)
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(139, 26, 26, 0.6)');
      g.addColorStop(1, 'rgba(80, 10, 10, 0.3)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      
      // Contorno quebrado
      ctx.strokeStyle = 'rgba(220, 50, 50, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    }
    
    // Bactérias - MUITAS e VIÁVEIS
    const bacteriaCount = Math.max(30, 50 - simulationData.healing);
    for (let i = 0; i < bacteriaCount; i++) {
      const x = ((i * 97 + seed * 31) % W);
      const y = ((i * 67 + seed * 23) % H);
      const r = 2 + ((i * 3 + seed * 5) % 2);
      
      // Bactérias vibrantes e ativas
      const g = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, r);
      g.addColorStop(0, 'rgba(200, 100, 80, 0.8)');
      g.addColorStop(1, 'rgba(100, 30, 30, 0.5)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      
      // Brilho bacteriano
      ctx.strokeStyle = 'rgba(255, 150, 100, 0.6)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Biofilme denso
    ctx.fillStyle = 'rgba(139, 26, 26, 0.15)';
    ctx.fillRect(W * 0.1, H * 0.4, W * 0.8, H * 0.5);
    ctx.strokeStyle = 'rgba(200, 50, 50, 0.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(W * 0.1, H * 0.4, W * 0.8, H * 0.5);
    ctx.setLineDash([]);
    
    // Texto
    ctx.fillStyle = 'rgba(200, 50, 50, 0.4)';
    ctx.font = 'bold 10px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Biofilme bacteriano', W * 0.5, H * 0.2);
    ctx.fillText('Inflamação ativa', W * 0.5, H * 0.95);
    
  } else {
    // ===== COM TRATAMENTO =====
    // Células epiteliais recuperando
    const cellCount = 12;
    for (let i = 0; i < cellCount; i++) {
      const x = 30 + ((i * 47 + seed * 11) % (W - 60));
      const y = 30 + ((i * 73 + seed * 17) % (H - 60));
      const r = 14 + ((i * 11 + seed * 7) % 8);
      
      // Célula recuperando
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0, 180, 160, 0.7)');
      g.addColorStop(1, 'rgba(0, 150, 140, 0.3)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      
      ctx.strokeStyle = 'rgba(0, 180, 160, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    }
    
    // Bactérias - POUCAS e MORTAS
    const bacteriaCount = Math.max(5, 40 - simulationData.bacteriaCtrl * 0.3);
    for (let i = 0; i < bacteriaCount; i++) {
      const x = ((i * 97 + seed * 31) % W);
      const y = ((i * 67 + seed * 23) % H);
      const r = 1.5 + ((i * 2 + seed * 3) % 1.5);
      
      // Bactérias mortas (decoloradas)
      const g = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, r);
      g.addColorStop(0, 'rgba(100, 100, 100, 0.5)');
      g.addColorStop(1, 'rgba(50, 50, 50, 0.2)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Taninos (moléculas do barbatimão)
    const taninoCount = 20 + Math.floor(simulationData.bacteriaCtrl * 0.2);
    for (let i = 0; i < taninoCount; i++) {
      const x = ((i * 79 + seed * 19) % W);
      const y = ((i * 83 + seed * 29) % H);
      const opacity = 0.3 + ((i % 5) * 0.1);
      
      ctx.fillStyle = `rgba(34, 197, 94, ${opacity})`;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Neutrófilos ativos
    const neutroCount = 6 + Math.floor(simulationData.bacteriaCtrl * 0.05);
    for (let i = 0; i < neutroCount; i++) {
      const x = 30 + ((i * 89 + seed * 13) % (W - 60));
      const y = 30 + ((i * 101 + seed * 37) % (H - 60));
      
      // Célula imune ativa
      const g = ctx.createRadialGradient(x - 2, y - 2, 0, x, y, 6);
      g.addColorStop(0, 'rgba(59, 130, 246, 0.9)');
      g.addColorStop(1, 'rgba(29, 78, 216, 0.5)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      
      // Halo de atividade
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Área de cicatrização (com base no healing %)
    const healingArea = simulationData.healing * 0.008; // Converte pct em fração visual
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(W * 0.15, H * 0.5, W * 0.7, H * 0.35);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(34, 197, 94, 0.08)';
    ctx.fillRect(W * 0.15, H * 0.5, W * 0.7, H * 0.35);
    
    // Texto
    ctx.fillStyle = 'rgba(34, 197, 94, 0.5)';
    ctx.font = 'bold 11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Cicatrização ativa', W * 0.5, H * 0.2);
    ctx.fillText(`Cicatrização ${simulationData.healing}%`, W * 0.5, H * 0.95);
  }
}
