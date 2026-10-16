/* ==========================================================================
   Sary Roast — демо-лендинг
   Чистый JavaScript без зависимостей. Что внутри:
   1. Аналитика: события в window.dataLayer (под GTM → GA4 / Яндекс.Метрика)
   2. Профиль обжарки: SVG-график, строится кодом и подстраивается под ширину
   3. Меню, лоты, FAQ
   4. Форма: валидация, UTM-метки, отправка заявки (заглушка под CRM)
   ========================================================================== */

(() => {
  'use strict';

  /* ---------- 1. Аналитика ---------- */

  const dataLayer = (window.dataLayer = window.dataLayer || []);
  const debug = new URLSearchParams(location.search).has('debug');

  /** Отправляет событие в dataLayer. Персональные данные сюда не попадают. */
  function track(event, params = {}) {
    dataLayer.push({ event, ...params });
    if (debug) console.log('[dataLayer]', event, params);
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- 2. Профиль обжарки ---------- */

  const ROAST_MINUTES = 12;
  const TEMP_MIN = 60;
  const TEMP_MAX = 230;

  // Контрольные точки: [минута, температура зерна, °C]
  const TEMP_POINTS = [
    [0, 200], [0.5, 150], [1.5, 96], [3, 116], [5, 152],
    [7, 178], [8.5, 194], [10.2, 205], [12, 214],
  ];

  const STAGES = [
    {
      from: 0, to: 4, name: 'Сушка', short: 'Сушка',
      note: 'Зерно отдаёт влагу и пахнет сеном и свежим хлебом. Пить такое нельзя: это ещё не кофе.',
    },
    {
      from: 4, to: 8.5, name: 'Реакция Майяра', short: 'Реакция Майяра',
      note: 'Зерно желтеет, потом коричневеет. Появляются запахи тоста и карамели, а вкус пока плоский.',
    },
    {
      from: 8.5, to: 10.2, name: 'Первый треск', short: '1-й треск',
      note: 'Зерно трескается и раскрывает кислотность: цитрус, ягоды, цветы. Здесь заканчивается светлая обжарка.',
    },
    {
      from: 10.2, to: ROAST_MINUTES + 0.001, name: 'Развитие', short: 'Развитие',
      note: 'Кислотность смягчается, появляются карамель, какао и орех. Это классическая средняя обжарка.',
      darkFrom: 11.2,
      darkNote: 'Горчинка и дымок выходят вперёд, ягод почти не остаётся. Хорошо для эспрессо и капучино.',
    },
  ];

  // Цвет зерна по времени обжарки: от зелёного до почти чёрного
  const BEAN_COLORS = [
    [0, [183, 196, 138]],
    [4, [214, 196, 120]],
    [8, [178, 128, 66]],
    [10, [122, 76, 40]],
    [12, [44, 26, 16]],
  ];

  const root = document.querySelector('[data-profile]');
  if (root) initProfile(root);

  function initProfile(profile) {
    const chartBox = profile.querySelector('[data-chart]');
    const slider = profile.querySelector('#roast-time');
    const beanIcon = profile.querySelector('[data-bean]');
    const chips = [...profile.querySelectorAll('[data-preset]')];
    const out = {
      time: profile.querySelector('[data-out="time"]'),
      temp: profile.querySelector('[data-out="temp"]'),
      stage: profile.querySelector('[data-out="stage"]'),
      note: profile.querySelector('[data-out="note"]'),
    };

    const SECONDS = 60; // ползунок хранит секунды: так «9:10» на кнопке и на графике совпадают точно
    const state = { t: Number(slider.value) / SECONDS, chart: null, firstRender: true };

    /* --- вспомогательные функции --- */

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

    function formatTime(t) {
      let m = Math.floor(t);
      let s = Math.round((t - m) * 60);
      if (s === 60) { m += 1; s = 0; }
      return `${m}:${String(s).padStart(2, '0')}`;
    }

    function lerp(a, b, k) { return a + (b - a) * k; }

    function beanColor(t) {
      const stops = BEAN_COLORS;
      if (t <= stops[0][0]) return `rgb(${stops[0][1].join(',')})`;
      for (let i = 1; i < stops.length; i++) {
        const [t1, c1] = stops[i];
        const [t0, c0] = stops[i - 1];
        if (t <= t1) {
          const k = (t - t0) / (t1 - t0);
          return `rgb(${c0.map((v, j) => Math.round(lerp(v, c1[j], k))).join(',')})`;
        }
      }
      return `rgb(${stops[stops.length - 1][1].join(',')})`;
    }

    function stageAt(t) {
      return STAGES.findIndex((s) => t >= s.from && t < s.to);
    }

    /** Запасной вариант без графика: линейная интерполяция по контрольным точкам. */
    function tempLinear(t) {
      for (let i = 1; i < TEMP_POINTS.length; i++) {
        const [t1, T1] = TEMP_POINTS[i];
        const [t0, T0] = TEMP_POINTS[i - 1];
        if (t <= t1) return lerp(T0, T1, (t - t0) / (t1 - t0));
      }
      return TEMP_POINTS[TEMP_POINTS.length - 1][1];
    }

    /** Кривая Катмулла — Рома → кубические Безье, чтобы линия была гладкой. */
    function smoothPath(points) {
      let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
      }
      return d;
    }

    const SVG_NS = 'http://www.w3.org/2000/svg';
    function svgEl(name, attrs = {}, parent) {
      const node = document.createElementNS(SVG_NS, name);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      if (parent) parent.appendChild(node);
      return node;
    }

    /* --- график --- */

    function renderChart() {
      const W = Math.max(300, Math.floor(chartBox.clientWidth));
      const H = W < 480 ? 250 : 320;
      const M = { l: 46, r: 14, t: 14, b: 34 };
      const plotW = W - M.l - M.r;
      const plotH = H - M.t - M.b;
      const x = (t) => M.l + (t / ROAST_MINUTES) * plotW;
      const y = (T) => M.t + plotH - ((T - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * plotH;

      chartBox.querySelector('svg')?.remove();

      const svg = svgEl('svg', {
        class: 'chart',
        viewBox: `0 0 ${W} ${H}`,
        role: 'img',
        'aria-label': 'График обжарки: температура зерна растёт от 96 до 214 градусов за 12 минут.',
      });
      chartBox.prepend(svg);

      const defs = svgEl('defs', {}, svg);
      const clip = svgEl('clipPath', { id: 'done-clip' }, defs);
      const clipRect = svgEl('rect', { x: 0, y: 0, width: x(state.t), height: H }, clip);

      // Стадии
      const bands = STAGES.map((stage, i) => {
        const band = svgEl('rect', {
          class: 'chart__band',
          x: x(stage.from).toFixed(1),
          y: M.t,
          width: (x(Math.min(stage.to, ROAST_MINUTES)) - x(stage.from)).toFixed(1),
          height: plotH,
          'data-stage': i,
        }, svg);
        if (W >= 520) {
          const label = svgEl('text', {
            class: 'chart__band-label',
            x: ((x(stage.from) + x(Math.min(stage.to, ROAST_MINUTES))) / 2).toFixed(1),
            y: M.t + 18,
            'text-anchor': 'middle',
          }, svg);
          label.textContent = stage.short;
        }
        return band;
      });

      // Сетка и подписи осей
      [100, 150, 200].forEach((T) => {
        svgEl('line', { class: 'chart__grid', x1: M.l, x2: W - M.r, y1: y(T), y2: y(T) }, svg);
        const label = svgEl('text', { class: 'chart__tick', x: M.l - 8, y: y(T) + 4, 'text-anchor': 'end' }, svg);
        label.textContent = `${T}°`;
      });
      const tickStep = W < 480 ? 4 : 2; // на узком экране подписи реже, чтобы не слипались
      for (let m = 0; m <= ROAST_MINUTES; m += tickStep) {
        const label = svgEl('text', {
          class: 'chart__tick',
          x: x(m),
          y: H - M.b + 22,
          'text-anchor': m === 0 ? 'start' : m === ROAST_MINUTES ? 'end' : 'middle',
        }, svg);
        label.textContent = m === ROAST_MINUTES ? '12 мин' : String(m);
      }

      // Кривая температуры
      const d = smoothPath(TEMP_POINTS.map(([t, T]) => [x(t), y(T)]));
      const curve = svgEl('path', { class: 'chart__curve', d }, svg);
      const done = svgEl('path', { class: 'chart__curve chart__curve--done', d, 'clip-path': 'url(#done-clip)' }, svg);

      // Маркер текущего момента
      const live = svgEl('g', { class: 'chart__live' }, svg);
      const line = svgEl('line', { class: 'chart__marker-line', y1: M.t, y2: H - M.b }, live);
      const dot = svgEl('circle', { class: 'chart__dot', r: 8 }, live);

      state.chart = { svg, curve, clipRect, bands, line, dot, x, M, plotH, W, H };

      // Один заранее продуманный «выход»: кривая прорисовывается, затем появляется маркер
      const len = curve.getTotalLength();
      if (state.firstRender && !reduceMotion.matches) {
        curve.style.strokeDasharray = len;
        curve.style.strokeDashoffset = len;
        curve.getBoundingClientRect(); // фиксируем стартовое состояние
        curve.classList.add('chart__curve--draw');
        curve.style.strokeDashoffset = 0;
        setTimeout(() => live.classList.add('is-visible'), 1500);
      } else {
        live.classList.add('is-visible');
      }
      state.firstRender = false;

      update(state.t);
    }

    /** Точка на кривой для заданной минуты (бинарный поиск по длине пути). */
    function pointOnCurve(t) {
      const { curve, x } = state.chart;
      const targetX = x(t);
      let lo = 0;
      let hi = curve.getTotalLength();
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (curve.getPointAtLength(mid).x < targetX) lo = mid; else hi = mid;
      }
      return curve.getPointAtLength(hi);
    }

    /* --- обновление интерфейса --- */

    function update(t) {
      state.t = clamp(t, 0, ROAST_MINUTES);
      const stageIndex = stageAt(state.t);
      const stage = STAGES[stageIndex] || STAGES[STAGES.length - 1];

      let temp = tempLinear(state.t);

      if (state.chart) {
        const c = state.chart;
        const p = pointOnCurve(state.t);
        c.dot.setAttribute('cx', p.x.toFixed(1));
        c.dot.setAttribute('cy', p.y.toFixed(1));
        c.line.setAttribute('x1', p.x.toFixed(1));
        c.line.setAttribute('x2', p.x.toFixed(1));
        c.clipRect.setAttribute('width', p.x.toFixed(1));
        c.bands.forEach((band, i) => band.classList.toggle('is-active', i === stageIndex));
        temp = TEMP_MIN + ((c.M.t + c.plotH - p.y) / c.plotH) * (TEMP_MAX - TEMP_MIN);
      }

      const timeText = formatTime(state.t);
      const note = stage.darkFrom && state.t >= stage.darkFrom ? stage.darkNote : stage.note;

      out.time.textContent = timeText;
      out.temp.textContent = `${Math.round(temp)} °C`;
      out.stage.textContent = stage.name;
      out.note.textContent = note;
      beanIcon.style.setProperty('--bean', beanColor(state.t));

      slider.value = String(Math.round(state.t * SECONDS));
      slider.setAttribute('aria-valuetext', `${timeText}, ${Math.round(temp)} градусов, ${stage.name}`);
    }

    function syncChips(activeValue) {
      chips.forEach((chip) => {
        chip.setAttribute('aria-pressed', String(activeValue !== null && Number(chip.dataset.preset) / SECONDS === activeValue));
      });
    }

    /* --- события --- */

    slider.addEventListener('input', () => {
      update(Number(slider.value) / SECONDS);
      syncChips(null);
    });

    // Одно событие на одно «действие»: ждём, пока человек перестанет двигать ползунок
    // (стрелками на клавиатуре «change» срабатывает на каждое нажатие)
    let sliderTimer;
    slider.addEventListener('change', () => {
      clearTimeout(sliderTimer);
      sliderTimer = setTimeout(() => {
        track('roast_slider_used', { roast_time: formatTime(state.t), roast_stage: STAGES[stageAt(state.t)]?.name });
      }, 800);
    });

    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const t = Number(chip.dataset.preset) / SECONDS;
        update(t);
        syncChips(t);
        track('roast_preset_used', { roast_time: formatTime(t) });
      });
    });

    // Кнопки «Показать профиль» в списке лотов
    document.querySelectorAll('[data-drop]').forEach((button) => {
      button.addEventListener('click', () => {
        const t = Number(button.dataset.drop) / SECONDS;
        update(t);
        syncChips(t);
        document.getElementById('profile').scrollIntoView({
          behavior: reduceMotion.matches ? 'auto' : 'smooth',
          block: 'start',
        });
        slider.focus({ preventScroll: true });
        track('lot_profile_view', { lot: button.dataset.lot, roast_time: formatTime(t) });
      });
    });

    // График подстраивается под ширину контейнера
    let resizeTimer;
    new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!state.chart || Math.floor(chartBox.clientWidth) !== state.chart.W) renderChart();
      }, 120);
    }).observe(chartBox);

    renderChart();
    syncChips(null);
  }

  /* ---------- 3. Меню, клики, секции, FAQ ---------- */

  const nav = document.getElementById('site-nav');
  const navToggle = document.querySelector('.nav-toggle');

  function setNav(open) {
    nav.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.textContent = open ? 'Закрыть' : 'Меню';
  }

  navToggle?.addEventListener('click', () => setNav(!nav.classList.contains('is-open')));
  nav?.addEventListener('click', (e) => { if (e.target.closest('a')) setNav(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) { setNav(false); navToggle.focus(); }
  });

  // Клики по основным кнопкам: имя кнопки берётся из data-cta
  document.addEventListener('click', (e) => {
    const cta = e.target.closest('[data-cta]');
    if (cta) track('cta_click', { cta: cta.dataset.cta, cta_text: cta.textContent.trim() });
  });

  // Просмотр секций: каждое событие один раз
  if ('IntersectionObserver' in window) {
    const seen = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        track('section_view', { section: entry.target.dataset.section });
        seen.unobserve(entry.target);
      });
    }, { threshold: 0.4 });
    document.querySelectorAll('[data-section]').forEach((section) => seen.observe(section));
  }

  document.querySelectorAll('.faq details').forEach((item) => {
    item.addEventListener('toggle', () => {
      if (item.open) track('faq_open', { question: item.querySelector('summary').textContent.trim() });
    });
  });

  /* ---------- 4. Форма ---------- */

  const form = document.getElementById('subscribe-form');
  if (form) initForm(form);

  function initForm(formEl) {
    const status = formEl.querySelector('[data-status]');
    const submit = formEl.querySelector('[type="submit"]');
    let started = false;

    // UTM-метки из адреса страницы → скрытые поля формы (дальше они уйдут в CRM)
    const params = new URLSearchParams(location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((key) => {
      const input = formEl.elements[key];
      if (input && params.has(key)) input.value = params.get(key);
    });

    const rules = {
      name: (field) =>
        field.value.trim().length >= 2 || 'Введите имя, хотя бы два символа.',
      contact: (field) => {
        const value = field.value.trim();
        const digits = value.replace(/\D/g, '');
        const isPhone = /^[\d\s()+-]+$/.test(value) && digits.length >= 10 && digits.length <= 12;
        const isTelegram = /^@?[A-Za-z0-9_]{5,32}$/.test(value);
        return isPhone || isTelegram || 'Укажите телефон, например +7 701 123 45 67, или Telegram в формате @username.';
      },
      consent: (field) =>
        field.checked || 'Без согласия на обработку данных мы не можем принять заявку.',
    };

    function validateField(name) {
      const field = formEl.elements[name];
      const error = document.getElementById(`${field.id}-error`);
      const result = rules[name](field);
      const valid = result === true;
      field.setAttribute('aria-invalid', String(!valid));
      error.hidden = valid;
      error.textContent = valid ? '' : result;
      return valid;
    }

    // Проверяем поле, когда человек из него вышел, а после первой ошибки — на каждый ввод
    Object.keys(rules).forEach((name) => {
      const field = formEl.elements[name];
      field.addEventListener('blur', () => { if (field.value || field.checked || field.getAttribute('aria-invalid')) validateField(name); });
      field.addEventListener('input', () => { if (field.getAttribute('aria-invalid') === 'true') validateField(name); });
    });

    formEl.addEventListener('focusin', () => {
      if (started) return;
      started = true;
      track('form_start', { form_id: 'subscribe' });
    });

    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      status.className = 'form__status';
      status.textContent = '';

      const results = Object.keys(rules).map((name) => [name, validateField(name)]);
      const firstInvalid = results.find(([, valid]) => !valid);
      if (firstInvalid) {
        formEl.elements[firstInvalid[0]].focus();
        track('form_error', { form_id: 'subscribe', field: firstInvalid[0] });
        return;
      }

      const payload = Object.fromEntries(new FormData(formEl));
      submit.disabled = true;
      submit.textContent = 'Отправляем…';

      try {
        await sendLead(payload);
        // В аналитику уходят только параметры подписки, без имени и контактов
        track('generate_lead', { form_id: 'subscribe', plan: payload.plan, roast: payload.roast, grind: payload.grind });
        status.className = 'form__status is-success';
        status.textContent = `Спасибо, ${payload.name.trim()}! Мы напишем вам в течение дня и уточним детали первой доставки.`;
        status.focus();
        formEl.reset();
        Object.keys(rules).forEach((name) => formEl.elements[name].removeAttribute('aria-invalid'));
      } catch (err) {
        status.textContent = 'Не удалось отправить заявку. Проверьте интернет и попробуйте ещё раз.';
        status.focus();
      } finally {
        submit.disabled = false;
        submit.textContent = 'Оформить подписку';
      }
    });
  }

  /**
   * Отправка заявки. Сейчас это заглушка: демо не хранит данные.
   * Для продакшена замените тело функции на запрос к собственному эндпоинту
   * (serverless-функция или бэкенд), который создаёт лид в Битрикс24 через REST (crm.lead.add).
   * URL вебхука Битрикс24 нельзя держать в клиентском коде: он даёт доступ к CRM.
   */
  async function sendLead(payload) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (debug) console.log('[lead payload]', payload);
    return { ok: true };
  }
})();
