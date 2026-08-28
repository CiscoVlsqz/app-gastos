// Mock del backend de Apps Script, solo para probar el front-end en el navegador.
// No se usa en el deploy real (ahí manda Code.gs a través de google.script.run).
(function () {
  var CATEGORIAS = [
    { nombre: 'Depto', icono: '🏠' },
    { nombre: 'Super', icono: '🛒' },
    { nombre: 'Boludeces', icono: '🎲' },
    { nombre: 'Mercado Libre', icono: '📦' },
    { nombre: 'Salidas', icono: '🍻' },
    { nombre: 'Gimnasio', icono: '🏋️' },
    { nombre: 'Suplementos', icono: '💊' },
    { nombre: 'Médico', icono: '⚕️' },
    { nombre: 'Nafta', icono: '⛽' },
    { nombre: 'Suscripciones', icono: '🔁' }
  ];
  var PERSONAS = ['Fran', 'Marti'];

  function todayISO(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    var tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 10);
  }

  function monthISO(offsetMonths) {
    var d = new Date();
    d.setMonth(d.getMonth() + offsetMonths);
    d.setDate(1);
    var tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 10);
  }

  var movimientos = [
    { id: 'm1', fecha: todayISO(0), categoria: 'Super', monto: 18500, pagadoPor: 'Marti', nota: 'Coto' },
    { id: 'm2', fecha: todayISO(0), categoria: 'Nafta', monto: 12000, pagadoPor: 'Fran', nota: '' },
    { id: 'm3', fecha: todayISO(-1), categoria: 'Salidas', monto: 9000, pagadoPor: 'Fran', nota: 'Birra con Nico' },
    { id: 'm4', fecha: todayISO(-1), categoria: 'Depto', monto: 150000, pagadoPor: 'Marti', nota: 'Ahorro del mes' },
    { id: 'm5', fecha: todayISO(-3), categoria: 'Gimnasio', monto: 25000, pagadoPor: 'Fran', nota: 'Cuota mensual' },
    { id: 'm6', fecha: todayISO(-3), categoria: 'Suplementos', monto: 30000, pagadoPor: 'Marti', nota: 'Proteína' },
    { id: 'm7', fecha: todayISO(-5), categoria: 'Suscripciones', monto: 8500, pagadoPor: 'Fran', nota: 'Netflix + Spotify' },
    { id: 'm8', fecha: todayISO(-8), categoria: 'Mercado Libre', monto: 22000, pagadoPor: 'Marti', nota: '' },
    { id: 'm9', fecha: monthISO(-1), categoria: 'Depto', monto: 145000, pagadoPor: 'Marti', nota: 'Ahorro del mes pasado' },
    { id: 'm10', fecha: monthISO(-1), categoria: 'Super', monto: 40000, pagadoPor: 'Fran', nota: '' }
  ];

  function frecuenciaPorCategoria() {
    var frec = {};
    movimientos.forEach(function (m) { frec[m.categoria] = (frec[m.categoria] || 0) + 1; });
    return frec;
  }

  window.MockApi = {
    getCategorias: function () {
      var frec = frecuenciaPorCategoria();
      return CATEGORIAS.slice().sort(function (a, b) {
        return (frec[b.nombre] || 0) - (frec[a.nombre] || 0);
      });
    },
    getPersonas: function () { return PERSONAS; },
    addMovimiento: function (data) {
      var id = 'm' + (movimientos.length + 1) + '-' + Date.now();
      movimientos.unshift({
        id: id,
        fecha: data.fecha || todayISO(0),
        categoria: data.categoria,
        monto: Number(data.monto),
        pagadoPor: data.pagadoPor,
        nota: data.nota || ''
      });
      return { id: id };
    },
    updateMovimiento: function (data) {
      var m = movimientos.find(function (m) { return m.id === data.id; });
      if (!m) throw new Error('No se encontró el movimiento');
      m.fecha = data.fecha || m.fecha;
      m.categoria = data.categoria;
      m.monto = Number(data.monto);
      m.pagadoPor = data.pagadoPor;
      m.nota = data.nota || '';
      return { ok: true };
    },
    getMovimientos: function (limit) {
      var sorted = movimientos.slice().sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
      return sorted.slice(0, limit || 100);
    },
    deleteMovimiento: function (id) {
      var idx = movimientos.findIndex(function (m) { return m.id === id; });
      if (idx === -1) return false;
      movimientos.splice(idx, 1);
      return true;
    },
    addCategoria: function (nombre, icono) {
      if (CATEGORIAS.some(function (c) { return c.nombre === nombre; })) {
        throw new Error('Esa categoría ya existe');
      }
      CATEGORIAS.push({ nombre: nombre, icono: icono || '💸' });
      return { ok: true };
    },
    updateCategoria: function (nombreOriginal, nuevoNombre, nuevoIcono) {
      var c = CATEGORIAS.find(function (c) { return c.nombre === nombreOriginal; });
      if (!c) throw new Error('No se encontró la categoría');
      c.nombre = nuevoNombre;
      c.icono = nuevoIcono || '💸';
      if (nuevoNombre !== nombreOriginal) {
        movimientos.forEach(function (m) {
          if (m.categoria === nombreOriginal) m.categoria = nuevoNombre;
        });
      }
      return { ok: true };
    },
    deleteCategoria: function (nombre) {
      var idx = CATEGORIAS.findIndex(function (c) { return c.nombre === nombre; });
      if (idx === -1) throw new Error('No se encontró la categoría');
      CATEGORIAS.splice(idx, 1);
      return { ok: true };
    },
    getResumenMes: function () {
      var yyyymm = todayISO(0).slice(0, 7);
      var prev = new Date();
      prev.setMonth(prev.getMonth() - 1);
      var yyyymmAnterior = prev.toISOString().slice(0, 7);
      var diaActual = new Date().getDate();

      var porCategoria = {}, porPersona = {}, porDia = {}, total = 0, totalMesAnterior = 0;
      for (var d = 1; d <= diaActual; d++) porDia[d] = 0;

      movimientos.forEach(function (m) {
        if (m.fecha.slice(0, 7) === yyyymmAnterior) {
          totalMesAnterior += m.monto;
          return;
        }
        if (m.fecha.slice(0, 7) !== yyyymm) return;
        porCategoria[m.categoria] = (porCategoria[m.categoria] || 0) + m.monto;
        porPersona[m.pagadoPor] = (porPersona[m.pagadoPor] || 0) + m.monto;
        var dia = parseInt(m.fecha.slice(8, 10), 10);
        if (porDia[dia] !== undefined) porDia[dia] += m.monto;
        total += m.monto;
      });

      var topCategoria = null, topCategoriaMonto = 0;
      Object.keys(porCategoria).forEach(function (c) {
        if (porCategoria[c] > topCategoriaMonto) { topCategoriaMonto = porCategoria[c]; topCategoria = c; }
      });

      return {
        porCategoria: porCategoria,
        porPersona: porPersona,
        porDia: porDia,
        diaActual: diaActual,
        total: total,
        mes: yyyymm,
        totalMesAnterior: totalMesAnterior,
        topCategoria: topCategoria,
        topCategoriaMonto: topCategoriaMonto
      };
    }
  };
})();
