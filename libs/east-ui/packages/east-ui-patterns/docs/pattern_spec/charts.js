/* East UI · pattern spec — chart bootstrap.
 * One ECharts theme tuned to the spec palette: brand-d line / brand-tint fill,
 * tabular numerics, no gridlines on the right/top, JetBrains Mono axis labels.
 * Each function takes a DOM element and lays out a chart inline.
 */
(function () {
  if (!window.echarts) return;

  const C = {
    brand:    '#488e97',
    brandD:   '#3a7780',
    brandDD:  '#2b4b55',
    brandTint:'#e8f6f7',
    ink:      '#111b22',
    ink3:     '#4a5f5f',
    ink4:     '#6b8080',
    ink5:     '#9bb0b0',
    rule:     '#e2e8e8',
    pos:      '#2f7a5b',
    neg:      '#b85a4a',
    paper:    '#ffffff'
  };

  const baseAxis = {
    axisLine: { lineStyle: { color: C.rule } },
    axisTick: { show: false },
    axisLabel: {
      color: C.ink4,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      fontWeight: 500
    },
    splitLine: { lineStyle: { color: C.rule, type: 'dashed' } }
  };

  function base(opt) {
    return Object.assign({
      animation: false,
      textStyle: { fontFamily: 'JetBrains Mono, monospace' },
      grid: { left: 44, right: 24, top: 24, bottom: 28, containLabel: false }
    }, opt);
  }

  function mount(el, option) {
    const c = echarts.init(el, null, { renderer: 'svg' });
    c.setOption(option);
    new ResizeObserver(() => c.resize()).observe(el);
    return c;
  }

  /* ------------------------------------------------------------------
   * 1. baseline-vs-action — two trajectories with tinted gap
   * ------------------------------------------------------------------ */
  function baselineVsAction(el) {
    const x = ['Wk1','Wk2','Wk3','Wk4','Wk5','Wk6','Wk7','Wk8'];
    const baseline = [1.94, 1.945, 1.93, 1.935, 1.94, 1.945, 1.93, 1.935];
    const rec = [1.94, 1.96, 1.985, 1.998, 2.005, 2.012, 2.018, 2.022];
    mount(el, base({
      grid: { left: 50, right: 90, top: 30, bottom: 32 },
      tooltip: { trigger: 'axis' },
      xAxis: Object.assign({}, baseAxis, { type: 'category', data: x, boundaryGap: false }),
      yAxis: Object.assign({}, baseAxis, {
        type: 'value', min: 1.9, max: 2.05,
        axisLabel: Object.assign({}, baseAxis.axisLabel, { formatter: '${value}M' })
      }),
      series: [
        { name: 'Do nothing', type: 'line', data: baseline,
          lineStyle: { color: C.ink4, width: 1.5, type: 'dashed' },
          symbol: 'none', endLabel: { show: true, color: C.ink4, fontSize: 10, fontFamily: 'JetBrains Mono', formatter: 'do nothing' } },
        { name: 'Follow rec', type: 'line', data: rec,
          lineStyle: { color: C.brandD, width: 2 },
          symbol: 'none',
          areaStyle: { color: C.brandTint, opacity: 0.6 },
          markLine: {
            silent: true, symbol: 'none', label: { color: C.ink3, fontFamily: 'JetBrains Mono', fontSize: 10, formatter: 'target $2.00M' },
            lineStyle: { color: C.ink3, type: 'dashed', width: 1 },
            data: [{ yAxis: 2.00 }]
          },
          endLabel: { show: true, color: C.brandD, fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 600, formatter: 'follow rec' }
        }
      ]
    }));
  }

  /* ------------------------------------------------------------------
   * 2. forecast-view — observed line + p10/p90 envelope + median
   * ------------------------------------------------------------------ */
  function forecastView(el) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const observed = [1.65, 1.7, 1.78, 1.74, 1.82, 1.86, 1.82, null, null, null, null, null];
    const p50 = [null, null, null, null, null, null, 1.82, 1.88, 1.94, 1.99, 2.04, 2.08];
    const p10 = [null, null, null, null, null, null, 1.82, 1.84, 1.88, 1.91, 1.94, 1.97];
    const p90 = [null, null, null, null, null, null, 1.82, 1.92, 2.00, 2.07, 2.14, 2.19];
    mount(el, base({
      grid: { left: 56, right: 28, top: 24, bottom: 32 },
      xAxis: Object.assign({}, baseAxis, { type: 'category', data: months, boundaryGap: false }),
      yAxis: Object.assign({}, baseAxis, { type: 'value', min: 1.5, max: 2.3, interval: 0.2,
        axisLabel: Object.assign({}, baseAxis.axisLabel, { formatter: v => '$' + v.toFixed(1) + 'M' }) }),
      series: [
        { name: 'p10', type: 'line', data: p10, lineStyle: { opacity: 0 }, symbol: 'none', stack: 'env', stackStrategy: 'all' },
        { name: 'p90-p10', type: 'line', data: p90.map((v,i) => v == null ? null : v - p10[i]),
          lineStyle: { opacity: 0 }, symbol: 'none', stack: 'env', stackStrategy: 'all',
          areaStyle: { color: C.brandTint, opacity: 0.7 } },
        { name: 'Observed', type: 'line', data: observed, lineStyle: { color: C.ink3, width: 1.5 }, symbol: 'none' },
        { name: 'Forecast', type: 'line', data: p50, lineStyle: { color: C.brandD, width: 1.5, type: 'dashed' }, symbol: 'none' }
      ],
      markLine: { silent: true }
    }));
  }

  /* ------------------------------------------------------------------
   * 3. projection-to-target
   * ------------------------------------------------------------------ */
  function projectionToTarget(el) {
    const x = ['W1','W2','W3','W4','W5','W6','W7','W8','W9','W10'];
    const traj = [1.50, 1.55, 1.62, 1.68, 1.74, 1.80, 1.86, 1.92, 1.98, 2.02];
    mount(el, base({
      grid: { left: 56, right: 32, top: 36, bottom: 32 },
      xAxis: Object.assign({}, baseAxis, { type: 'category', data: x, boundaryGap: false }),
      yAxis: Object.assign({}, baseAxis, { type: 'value', min: 1.4, max: 2.1, interval: 0.2,
        axisLabel: Object.assign({}, baseAxis.axisLabel, { formatter: v => '$' + v.toFixed(1) + 'M' }) }),
      series: [{
        type: 'line', data: traj, symbol: 'none',
        lineStyle: { color: C.brandD, width: 1.8 },
        areaStyle: { color: C.brandTint, opacity: 0.6 },
        markLine: { silent: true, symbol: 'none',
          lineStyle: { color: C.ink3, type: 'dashed', width: 1 },
          label: { color: C.ink3, fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 600, position: 'insideStartTop', formatter: 'target  $2.00M' },
          data: [{ yAxis: 2.00 }] },
        markPoint: { symbol: 'circle', symbolSize: 8, itemStyle: { color: C.brandD },
          label: { show: true, position: 'top', distance: 8, color: C.ink, fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 600,
                   formatter: 'likely  $2.02M' },
          data: [{ name: 'likely', coord: [9, 2.02] }] }
      }]
    }));
  }

  /* ------------------------------------------------------------------
   * 4. outcome-range — horizontal scale with p10–p90 band
   * ------------------------------------------------------------------ */
  function outcomeRange(el) {
    mount(el, base({
      grid: { left: 24, right: 24, top: 64, bottom: 28 },
      xAxis: Object.assign({}, baseAxis, { type: 'value', min: 1.6, max: 2.4,
        splitLine: { show: false },
        axisLabel: Object.assign({}, baseAxis.axisLabel, { formatter: '${value}M' }) }),
      yAxis: { show: false, type: 'category', data: [''] },
      series: [{
        type: 'custom',
        renderItem: function (params, api) {
          const yc = api.coord([0, 0])[1];
          const x10 = api.coord([1.96, 0])[0];
          const x90 = api.coord([2.08, 0])[0];
          const xCur = api.coord([2.02, 0])[0];
          return {
            type: 'group',
            children: [
              { type: 'rect', shape: { x: x10, y: yc - 8, width: x90 - x10, height: 16 },
                style: { fill: C.brandTint, stroke: C.brandD, lineWidth: 1 } },
              { type: 'circle', shape: { cx: xCur, cy: yc, r: 5 },
                style: { fill: C.brandD } },
              { type: 'text', style: { x: (x10 + x90) / 2, y: yc + 24, text: '$1.96M–$2.08M (p10–p90)',
                fill: C.ink, font: 'bold 11px JetBrains Mono', textAlign: 'center' } },
              // band labels
              { type: 'text', style: { x: api.coord([1.7, 0])[0], y: yc - 32, text: 'EXTREME', fill: C.ink4, font: '600 10px JetBrains Mono', textAlign: 'center' } },
              { type: 'text', style: { x: api.coord([1.85, 0])[0], y: yc - 32, text: 'PLAUSIBLE', fill: C.ink4, font: '600 10px JetBrains Mono', textAlign: 'center' } },
              { type: 'text', style: { x: api.coord([2.02, 0])[0], y: yc - 32, text: 'LIKELY', fill: C.ink, font: '700 10px JetBrains Mono', textAlign: 'center' } },
              { type: 'text', style: { x: api.coord([2.18, 0])[0], y: yc - 32, text: 'PLAUSIBLE', fill: C.ink4, font: '600 10px JetBrains Mono', textAlign: 'center' } },
              { type: 'text', style: { x: api.coord([2.33, 0])[0], y: yc - 32, text: 'EXTREME', fill: C.ink4, font: '600 10px JetBrains Mono', textAlign: 'center' } }
            ]
          };
        },
        data: [[2.02, 0]]
      }]
    }));
  }

  /* ------------------------------------------------------------------
   * 5. actual-vs-predicted — scatter with y=x ref + residual band
   * ------------------------------------------------------------------ */
  function actualVsPredicted(el) {
    const points = [
      [1.2,1.18],[1.3,1.34],[1.4,1.42],[1.5,1.48],[1.6,1.65],
      [1.7,1.68],[1.8,1.83],[1.9,1.92],[2.0,1.98],[2.1,2.14],
      [2.2,2.18],[2.3,2.31],[2.4,2.37]
    ];
    mount(el, base({
      grid: { left: 60, right: 28, top: 24, bottom: 36 },
      xAxis: Object.assign({}, baseAxis, { type: 'value', min: 1.0, max: 2.5,
        name: 'observed ($M)', nameLocation: 'middle', nameGap: 22,
        nameTextStyle: { color: C.ink4, fontFamily: 'JetBrains Mono', fontSize: 10 },
        axisLabel: Object.assign({}, baseAxis.axisLabel, { formatter: '${value}M' }) }),
      yAxis: Object.assign({}, baseAxis, { type: 'value', min: 1.0, max: 2.5,
        name: 'predicted ($M)', nameLocation: 'middle', nameGap: 42,
        nameTextStyle: { color: C.ink4, fontFamily: 'JetBrains Mono', fontSize: 10 },
        axisLabel: Object.assign({}, baseAxis.axisLabel, { formatter: '${value}M' }) }),
      series: [
        // residual band (markArea on y=x ± 0.1)
        { type: 'line', data: [[1, 0.9], [2.5, 2.4]], symbol: 'none', lineStyle: { opacity: 0 }, silent: true,
          markArea: { silent: true,
            itemStyle: { color: C.brandTint, opacity: 0.5 },
            data: [[
              { coord: [1.0, 1.1] },
              { coord: [2.5, 2.6] }
            ], [
              { coord: [1.0, 0.9] },
              { coord: [2.5, 2.4] }
            ]]
          }
        },
        { type: 'line', data: [[1, 1], [2.5, 2.5]], symbol: 'none',
          lineStyle: { color: C.brandD, width: 1, type: 'dashed' }, silent: true },
        { type: 'scatter', data: points, symbolSize: 7,
          itemStyle: { color: C.brandD } }
      ]
    }));
  }

  /* ------------------------------------------------------------------
   * 6. spark — tiny line/area used in Stat.Card
   * ------------------------------------------------------------------ */
  function spark(el, data, opts) {
    opts = opts || {};
    mount(el, {
      animation: false,
      grid: { left: 0, right: 0, top: 4, bottom: 4 },
      xAxis: { type: 'category', show: false, boundaryGap: false, data: data.map((_, i) => i) },
      yAxis: { type: 'value', show: false, scale: true },
      series: [{
        type: 'line', data: data, symbol: 'none',
        lineStyle: { color: opts.color || C.brandD, width: 1.5 },
        areaStyle: opts.area === false ? null : { color: C.brandTint, opacity: 0.7 }
      }]
    });
  }

  /* ------------------------------------------------------------------
   * 7. driver-bars — simple horizontal bars with positive/negative tint
   * ------------------------------------------------------------------ */
  function driverBars(el) {
    const data = [
      { name: 'holiday-demand',    pct: 14, color: C.brand },
      { name: 'inventory-buffer',  pct: 6,  color: C.brand },
      { name: 'weekend-coverage',  pct: -2, color: C.neg },
      { name: 'new-supplier-LT',   pct: -1, color: C.neg }
    ];
    mount(el, base({
      grid: { left: 140, right: 60, top: 8, bottom: 8 },
      xAxis: Object.assign({}, baseAxis, { type: 'value', min: -4, max: 16, splitLine: { show: false },
        axisLine: { show: false }, axisLabel: { show: false } }),
      yAxis: Object.assign({}, baseAxis, { type: 'category', data: data.map(d => d.name).reverse(),
        axisLabel: { color: C.ink, fontFamily: 'JetBrains Mono', fontSize: 11 },
        axisLine: { show: false }, splitLine: { show: false } }),
      series: [{
        type: 'bar', barWidth: 8,
        data: data.map(d => ({ value: d.pct, itemStyle: { color: d.color, borderRadius: 2 } })).reverse(),
        label: { show: true, position: 'right', color: C.ink, fontFamily: 'JetBrains Mono', fontSize: 11,
          formatter: ({ value }) => (value > 0 ? '+' : '') + value + '%' }
      }]
    }));
  }

  /* stackedColumn — staffed-hours by role per day, threshold band */
  function stackedColumn(el) {
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    mount(el, base({
      grid: { left: 44, right: 24, top: 28, bottom: 32 },
      xAxis: Object.assign({}, baseAxis, { type: 'category', data: days }),
      yAxis: Object.assign({}, baseAxis, { type: 'value', max: 80,
        axisLabel: Object.assign({}, baseAxis.axisLabel, { formatter: '{value}h' }) }),
      series: [
        { name: 'Picker', type: 'bar', stack: 's', barWidth: 18,
          data: [22,24,26,28,30,32,28], itemStyle: { color: C.brandD } },
        { name: 'Packer', type: 'bar', stack: 's', barWidth: 18,
          data: [12,14,14,16,18,20,16], itemStyle: { color: C.brand } },
        { name: 'Loader', type: 'bar', stack: 's', barWidth: 18,
          data: [8,8,10,12,14,14,10], itemStyle: { color: C.ink5 } },
        { type: 'line', data: [42,46,50,56,64,70,54], symbol: 'none',
          lineStyle: { color: C.neg, type: 'dashed', width: 1.2 },
          markLine: { silent: true, symbol: 'none', label: { show: false },
            lineStyle: { color: C.neg, type: 'dashed' } } }
      ]
    }));
  }

  /* groupedColumns — week-over-week comparison */
  function groupedColumns(el) {
    const cats = ['SE','NE','MW','SW','W'];
    mount(el, base({
      grid: { left: 44, right: 24, top: 28, bottom: 32 },
      xAxis: Object.assign({}, baseAxis, { type: 'category', data: cats }),
      yAxis: Object.assign({}, baseAxis, { type: 'value',
        axisLabel: Object.assign({}, baseAxis.axisLabel, { formatter: '{value}%' }) }),
      series: [
        { name: 'Last week', type: 'bar', barWidth: 12, barGap: '20%',
          data: [82,76,88,71,84], itemStyle: { color: C.ink5, borderRadius: 1 } },
        { name: 'This week', type: 'bar', barWidth: 12,
          data: [89,72,91,79,86], itemStyle: { color: C.brandD, borderRadius: 1 } }
      ]
    }));
  }

  /* areaCumulative — cumulative reward over training */
  function areaCumulative(el) {
    const x = Array.from({length: 24}, (_, i) => i + 1);
    const cum = x.map(i => 100 * (1 - Math.exp(-i / 6)) + Math.sin(i / 2) * 2);
    mount(el, base({
      grid: { left: 50, right: 24, top: 24, bottom: 32 },
      xAxis: Object.assign({}, baseAxis, { type: 'category', data: x.map(String), boundaryGap: false,
        axisLabel: Object.assign({}, baseAxis.axisLabel, { formatter: 'h{value}' }) }),
      yAxis: Object.assign({}, baseAxis, { type: 'value', max: 100,
        axisLabel: Object.assign({}, baseAxis.axisLabel, { formatter: '{value}%' }) }),
      series: [{
        type: 'line', data: cum, symbol: 'none', smooth: 0.3,
        lineStyle: { color: C.brandD, width: 1.8 },
        areaStyle: { color: C.brandTint, opacity: 0.85 },
        markLine: { silent: true, symbol: 'none',
          lineStyle: { color: C.brand, type: 'dashed', width: 1 },
          label: { color: C.brand, fontFamily: 'JetBrains Mono', fontSize: 10, formatter: 'SLA 95%' },
          data: [{ yAxis: 95 }] }
      }]
    }));
  }

  /* brushedTimeseries — supply/demand bars with brushable selection highlight */
  function brushedTimeseries(el) {
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const supply = [42,46,48,52,54,52,48];
    const demand = [40,44,48,56,64,70,54];
    mount(el, base({
      grid: { left: 48, right: 24, top: 36, bottom: 32 },
      xAxis: Object.assign({}, baseAxis, { type: 'category', data: days, boundaryGap: true }),
      yAxis: Object.assign({}, baseAxis, { type: 'value', max: 80, interval: 20,
        axisLabel: Object.assign({}, baseAxis.axisLabel, { formatter: '{value}h' }) }),
      series: [
        { name: 'Demand', type: 'bar', barWidth: 22,
          data: demand,
          itemStyle: { color: C.brandTint, borderColor: C.brand, borderWidth: 1, borderRadius: 1 } },
        { name: 'Supply', type: 'line', data: supply, symbol: 'circle', symbolSize: 5,
          lineStyle: { color: C.brandD, width: 1.8 },
          itemStyle: { color: C.brandD },
          markArea: { silent: true,
            itemStyle: { color: C.brand, opacity: 0.18, borderColor: C.brandD, borderWidth: 1.5, borderType: 'solid' },
            label: { show: true, color: C.brandDD, fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700, position: 'insideTop', distance: 6, formatter: 'brushed · Thu–Sat' },
            data: [[{ xAxis: 'Thu' }, { xAxis: 'Sat' }]]
          } }
      ],
      graphic: [
        { type: 'rect', z: 100, left: '52%', top: 8, shape: { width: 14, height: 14 },
          style: { fill: C.brand, opacity: 0.18, stroke: C.brandD, lineWidth: 1.2 } },
        { type: 'text', z: 100, left: '52%', top: 8,
          style: { x: 20, y: 11, text: 'shortfall window', fill: C.ink3, font: '600 10px JetBrains Mono' } }
      ]
    }));
  }

  // expose
  window.SpecCharts = {
    baselineVsAction, forecastView, projectionToTarget,
    outcomeRange, actualVsPredicted, spark, driverBars,
    stackedColumn, groupedColumns, areaCumulative, brushedTimeseries,
    mount, C, baseAxis, base
  };

  // auto-mount any [data-spec-chart] element
  function init() {
    document.querySelectorAll('[data-spec-chart]').forEach(el => {
      const fn = window.SpecCharts[el.dataset.specChart];
      if (typeof fn === 'function') fn(el);
    });
    document.querySelectorAll('[data-spec-spark]').forEach(el => {
      const data = JSON.parse(el.dataset.specSpark);
      spark(el, data, { area: el.dataset.area !== 'false' });
    });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 0);
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
