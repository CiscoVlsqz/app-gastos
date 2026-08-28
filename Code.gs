/**
 * Gastos Fran & Marti — backend Apps Script
 *
 * Estructura esperada del Spreadsheet (se crea sola la primera vez que
 * corras `setup()` desde el editor de Apps Script):
 *   - Movimientos: ID | Fecha | Categoria | Monto | PagadoPor | Nota | RegistradoEl
 *   - Config: Categoria | Icono
 *   - Resumen: hoja de solo lectura con formulas SUMIFS sobre Movimientos
 */

var SHEET_MOVIMIENTOS = 'Movimientos';
var SHEET_CONFIG = 'Config';
var SHEET_RESUMEN = 'Resumen';

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

var SHEET_ID = '1uvRu_gxiMeAV39lkBWlmqJfjoRcihZWNH0Zg1eLMvog';

// Token simple para el endpoint del Atajo de iOS. Cambialo por algo tuyo
// antes de implementar, y usá ese mismo valor en el Atajo.
var API_TOKEN = 'fran-marti-2026';

function getSS() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function doGet(e) {
  var p = (e && e.parameter) || {};

  // ---- API para la web app (front en hosting estático) ----
  // Apps Script no manda headers de CORS, así que el front llama por JSONP:
  //   /exec?fn=<funcion>&args=<json>&callback=<nombre>
  // y esto devuelve  <nombre>({ ok, data }) / <nombre>({ ok, error })
  // como JavaScript. Un <script src> no pasa por el chequeo de CORS.
  if (p.fn) {
    var payload;
    try {
      var args = p.args ? JSON.parse(p.args) : [];
      payload = { ok: true, data: rpcDispatch(p.fn, args) };
    } catch (err) {
      payload = { ok: false, error: err.message };
    }
    var body = JSON.stringify(payload);
    if (p.callback) {
      return ContentService
        .createTextOutput(p.callback + '(' + body + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return jsonOut(payload);
  }

  // compat con lo anterior
  if (p.action === 'categorias') return jsonOut({ ok: true, data: getCategorias() });
  if (p.action === 'personas') return jsonOut({ ok: true, data: getPersonas() });

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Gastos Fran & Marti')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

/**
 * Endpoint POST. Dos modos:
 *
 *  1. Atajo de iOS: JSON { token, categoria, monto, pagadoPor, fecha?, nota? }
 *     — devuelve { ok: true, id }.
 *
 *  2. JSON { fn, args } — mismo dispatcher que usa la web app, por si algún
 *     día conviene llamarlo por POST desde el mismo origen. La web app en
 *     hosting estático NO usa esto: usa JSONP por GET (ver doGet), porque
 *     Apps Script no manda headers de CORS.
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data && data.fn) {
      return jsonOut({ ok: true, data: rpcDispatch(data.fn, data.args || []) });
    }

    if (data.token !== API_TOKEN) {
      throw new Error('Token inválido');
    }
    var result = addMovimiento(data);
    return jsonOut({ ok: true, id: result.id });
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

/**
 * Whitelist de funciones que el front puede llamar por { fn, args }.
 * Cualquier otra cosa tira error.
 */
function rpcDispatch(fn, args) {
  switch (fn) {
    case 'getCategorias':    return getCategorias();
    case 'getPersonas':      return getPersonas();
    case 'getMovimientos':   return getMovimientos(args[0]);
    case 'getResumenMes':    return getResumenMes();
    case 'addMovimiento':    return addMovimiento(args[0]);
    case 'updateMovimiento': return updateMovimiento(args[0]);
    case 'deleteMovimiento': return deleteMovimiento(args[0]);
    case 'addCategoria':     return addCategoria(args[0], args[1]);
    case 'updateCategoria':  return updateCategoria(args[0], args[1], args[2]);
    case 'deleteCategoria':  return deleteCategoria(args[0]);
    default: throw new Error('Función no permitida: ' + fn);
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Crea las hojas y las deja con encabezados + categorías si no existen.
 * Correr una sola vez a mano desde el editor de Apps Script.
 */
function setup() {
  var ss = getSS();

  var mov = ss.getSheetByName(SHEET_MOVIMIENTOS) || ss.insertSheet(SHEET_MOVIMIENTOS);
  if (mov.getLastRow() === 0) {
    mov.appendRow(['ID', 'Fecha', 'Categoria', 'Monto', 'PagadoPor', 'Nota', 'RegistradoEl']);
    mov.setFrozenRows(1);
  }

  var config = ss.getSheetByName(SHEET_CONFIG) || ss.insertSheet(SHEET_CONFIG);
  if (config.getLastRow() === 0) {
    config.appendRow(['Categoria', 'Icono']);
    CATEGORIAS.forEach(function (c) {
      config.appendRow([c.nombre, c.icono]);
    });
    config.setFrozenRows(1);
  }

  var resumen = ss.getSheetByName(SHEET_RESUMEN) || ss.insertSheet(SHEET_RESUMEN);
  if (resumen.getLastRow() === 0) {
    resumen.appendRow(['Categoria', 'Total mes actual']);
    CATEGORIAS.forEach(function (c, i) {
      var row = i + 2;
      resumen.appendRow([
        c.nombre,
        '=SUMIFS(' + SHEET_MOVIMIENTOS + '!D:D,' +
          SHEET_MOVIMIENTOS + '!C:C,A' + row + ',' +
          SHEET_MOVIMIENTOS + '!B:B,">="&EOMONTH(TODAY(),-1)+1,' +
          SHEET_MOVIMIENTOS + '!B:B,"<="&EOMONTH(TODAY(),0))'
      ]);
    });
    resumen.setFrozenRows(1);

    var lastRow = CATEGORIAS.length + 2;
    resumen.getRange(lastRow, 1).setValue('Total');
    resumen.getRange(lastRow, 2).setFormula('=SUM(B2:B' + (lastRow - 1) + ')');

    PERSONAS.forEach(function (p, i) {
      var row = lastRow + 2 + i;
      resumen.getRange(row, 1).setValue('Pagado por ' + p);
      resumen.getRange(row, 2).setFormula(
        '=SUMIFS(' + SHEET_MOVIMIENTOS + '!D:D,' +
          SHEET_MOVIMIENTOS + '!E:E,"' + p + '",' +
          SHEET_MOVIMIENTOS + '!B:B,">="&EOMONTH(TODAY(),-1)+1,' +
          SHEET_MOVIMIENTOS + '!B:B,"<="&EOMONTH(TODAY(),0))'
      );
    });
  }
}

function getCategorias() {
  var ss = getSS();
  var configSheet = ss.getSheetByName(SHEET_CONFIG);
  var base = CATEGORIAS;
  if (configSheet) {
    var values = configSheet.getDataRange().getValues();
    var out = [];
    for (var i = 1; i < values.length; i++) {
      if (values[i][0]) out.push({ nombre: values[i][0], icono: values[i][1] || '💸' });
    }
    if (out.length) base = out;
  }

  // Categorías más usadas primero, según el historial de Movimientos.
  var frecuencia = {};
  var movSheet = ss.getSheetByName(SHEET_MOVIMIENTOS);
  if (movSheet) {
    var lastRow = movSheet.getLastRow();
    if (lastRow > 1) {
      var cats = movSheet.getRange(2, 3, lastRow - 1, 1).getValues();
      cats.forEach(function (row) {
        if (row[0]) frecuencia[row[0]] = (frecuencia[row[0]] || 0) + 1;
      });
    }
  }

  return base.slice().sort(function (a, b) {
    return (frecuencia[b.nombre] || 0) - (frecuencia[a.nombre] || 0);
  });
}

function getPersonas() {
  return PERSONAS;
}

/**
 * Agrega una categoría nueva a la hoja Config.
 */
function addCategoria(nombre, icono) {
  if (!nombre) throw new Error('Falta el nombre de la categoría');
  var ss = getSS();
  var config = ss.getSheetByName(SHEET_CONFIG);
  if (!config) throw new Error('No existe la hoja Config');

  var values = config.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === nombre) throw new Error('Esa categoría ya existe');
  }
  config.appendRow([nombre, icono || '💸']);
  return { ok: true };
}

/**
 * Renombra/actualiza el ícono de una categoría en Config y, si cambió el
 * nombre, actualiza también los movimientos ya cargados con ese nombre.
 */
function updateCategoria(nombreOriginal, nuevoNombre, nuevoIcono) {
  if (!nombreOriginal || !nuevoNombre) throw new Error('Faltan datos de la categoría');
  var ss = getSS();
  var config = ss.getSheetByName(SHEET_CONFIG);
  if (!config) throw new Error('No existe la hoja Config');

  var values = config.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === nombreOriginal) {
      config.getRange(i + 1, 1).setValue(nuevoNombre);
      config.getRange(i + 1, 2).setValue(nuevoIcono || '💸');
      found = true;
      break;
    }
  }
  if (!found) throw new Error('No se encontró la categoría');

  if (nuevoNombre !== nombreOriginal) {
    var mov = ss.getSheetByName(SHEET_MOVIMIENTOS);
    var lastRow = mov.getLastRow();
    if (lastRow > 1) {
      var cats = mov.getRange(2, 3, lastRow - 1, 1).getValues();
      for (var r = 0; r < cats.length; r++) {
        if (cats[r][0] === nombreOriginal) {
          mov.getRange(r + 2, 3).setValue(nuevoNombre);
        }
      }
    }
  }
  return { ok: true };
}

/**
 * Borra una categoría de Config. Los movimientos ya cargados con ese
 * nombre no se tocan (quedan con el nombre viejo en el historial).
 */
function deleteCategoria(nombre) {
  var ss = getSS();
  var config = ss.getSheetByName(SHEET_CONFIG);
  if (!config) throw new Error('No existe la hoja Config');

  var values = config.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === nombre) {
      config.deleteRow(i + 1);
      return { ok: true };
    }
  }
  throw new Error('No se encontró la categoría');
}

function addMovimiento(data) {
  if (!data || !data.categoria || !data.monto || !data.pagadoPor) {
    throw new Error('Faltan datos del movimiento');
  }
  var monto = Number(data.monto);
  if (!isFinite(monto) || monto <= 0) {
    throw new Error('Monto inválido');
  }

  var ss = getSS();
  var sheet = ss.getSheetByName(SHEET_MOVIMIENTOS);
  var id = Utilities.getUuid();
  var fecha = data.fecha ? new Date(data.fecha + 'T12:00:00') : new Date();

  sheet.appendRow([id, fecha, data.categoria, monto, data.pagadoPor, data.nota || '', new Date()]);

  return { id: id };
}

/**
 * Actualiza un movimiento existente (buscado por ID) en la misma fila
 * donde ya vive en Movimientos.
 */
function updateMovimiento(data) {
  if (!data || !data.id) throw new Error('Falta el ID del movimiento');
  if (!data.categoria || !data.monto || !data.pagadoPor) {
    throw new Error('Faltan datos del movimiento');
  }
  var monto = Number(data.monto);
  if (!isFinite(monto) || monto <= 0) {
    throw new Error('Monto inválido');
  }

  var ss = getSS();
  var sheet = ss.getSheetByName(SHEET_MOVIMIENTOS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('No hay movimientos cargados');

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === data.id) {
      var row = i + 2;
      var fecha = data.fecha ? new Date(data.fecha + 'T12:00:00') : new Date();
      sheet.getRange(row, 2, 1, 5).setValues([[fecha, data.categoria, monto, data.pagadoPor, data.nota || '']]);
      return { ok: true };
    }
  }
  throw new Error('No se encontró el movimiento');
}

function getMovimientos(limit) {
  limit = limit || 100;
  var ss = getSS();
  var sheet = ss.getSheetByName(SHEET_MOVIMIENTOS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row[2]) continue;
    out.push({
      id: row[0],
      fecha: Utilities.formatDate(new Date(row[1]), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      categoria: row[2],
      monto: row[3],
      pagadoPor: row[4],
      nota: row[5]
    });
  }
  out.sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
  return out.slice(0, limit);
}

function deleteMovimiento(id) {
  var ss = getSS();
  var sheet = ss.getSheetByName(SHEET_MOVIMIENTOS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

/**
 * Rellena con un UUID las filas de Movimientos que tengan el ID vacío
 * (por ejemplo, filas cargadas a mano directo en la planilla).
 * Correr una sola vez a mano desde el editor de Apps Script.
 */
function backfillIds() {
  var ss = getSS();
  var sheet = ss.getSheetByName(SHEET_MOVIMIENTOS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (!ids[i][0]) {
      sheet.getRange(i + 2, 1).setValue(Utilities.getUuid());
    }
  }
}

function getResumenMes() {
  var movimientos = getMovimientos(10000);
  var now = new Date();
  var yyyymm = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM');
  var prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var yyyymmAnterior = Utilities.formatDate(prevDate, Session.getScriptTimeZone(), 'yyyy-MM');
  var diaActual = now.getDate();

  var porCategoria = {};
  var porPersona = {};
  var porDia = {};
  var total = 0;
  var totalMesAnterior = 0;

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

  var topCategoria = null;
  var topCategoriaMonto = 0;
  Object.keys(porCategoria).forEach(function (c) {
    if (porCategoria[c] > topCategoriaMonto) {
      topCategoriaMonto = porCategoria[c];
      topCategoria = c;
    }
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
