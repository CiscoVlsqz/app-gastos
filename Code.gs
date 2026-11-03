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
  var cache = CacheService.getScriptCache();
  var cached = cache.get('categorias_v1');
  if (cached) {
    return JSON.parse(cached);
  }

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

  var resultado = base.slice().sort(function (a, b) {
    return (frecuencia[b.nombre] || 0) - (frecuencia[a.nombre] || 0);
  });

  cache.put('categorias_v1', JSON.stringify(resultado), 300);
  return resultado;
}

/**
 * Invalida la cache de getCategorias(). Hay que llamarla en cualquier
 * operación que pueda cambiar el resultado (altas/bajas/cambios de
 * movimientos o de categorías).
 */
function invalidarCacheCategorias() {
  CacheService.getScriptCache().remove('categorias_v1');
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
  invalidarCacheCategorias();
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
  invalidarCacheCategorias();
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
      invalidarCacheCategorias();
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

  invalidarCacheCategorias();
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
      invalidarCacheCategorias();
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
      invalidarCacheCategorias();
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

/**
 * ===== Bot de Telegram =====
 *
 * Flujo: audio de voz -> transcripción (Groq Whisper) -> extracción de
 * datos del gasto (Groq LLM) -> confirmación con botones -> addMovimiento.
 *
 * Secretos (Project Settings > Script Properties, NUNCA hardcodeados):
 *   TELEGRAM_BOT_TOKEN, GROQ_API_KEY, TELEGRAM_CHAT_FRAN, TELEGRAM_CHAT_MARTI
 */

/**
 * Devuelve un mapa { "<chatId>": "Fran", "<chatId>": "Marti" } armado a
 * partir de las Script Properties. Si TELEGRAM_CHAT_MARTI todavía no está
 * seteada, Marti simplemente no tiene acceso aún (no rompe nada).
 */
function getTelegramPersonas_() {
  var props = PropertiesService.getScriptProperties();
  var mapa = {};
  var chatFran = props.getProperty('TELEGRAM_CHAT_FRAN');
  var chatMarti = props.getProperty('TELEGRAM_CHAT_MARTI');
  if (chatFran) mapa[chatFran] = 'Fran';
  if (chatMarti) mapa[chatMarti] = 'Marti';
  return mapa;
}

/**
 * Devuelve el nombre de la persona dueña de ese chatId, o null si no está
 * autorizada (en cuyo caso no hay que responderle nada).
 */
function resolvePersonaPorChatId_(chatId) {
  var personas = getTelegramPersonas_();
  return personas[String(chatId)] || null;
}

/**
 * Despacha un update de Telegram según su tipo.
 */
function handleTelegramUpdate_(update) {
  if (update.callback_query) {
    handleTelegramCallback_(update.callback_query);
    return;
  }
  if (update.message) {
    handleTelegramMessage_(update.message);
    return;
  }
  // Otro tipo de update (edited_message, etc.): no hacemos nada.
}

/**
 * Procesa un mensaje entrante. Solo soportamos audio de voz por ahora.
 */
function handleTelegramMessage_(message) {
  var chatId = message.chat.id;
  var persona = resolvePersonaPorChatId_(chatId);
  if (!persona) return;

  if (!message.voice) {
    tgSendMessage_(chatId, 'Mandame un audio contando el gasto 🎙️');
    return;
  }

  var filePath = tgGetFilePath_(message.voice.file_id);
  var audioBlob = tgDownloadFile_(filePath);
  var transcript = groqTranscribe_(audioBlob);

  if (!transcript || !transcript.trim()) {
    tgSendMessage_(chatId, 'No pude escuchar nada, probá de nuevo.');
    return;
  }

  var parsed = groqParseExpense_(transcript, getCategorias(), getPersonas());

  if (!parsed || !parsed.monto || !isFinite(Number(parsed.monto)) || Number(parsed.monto) <= 0) {
    tgSendMessage_(chatId, 'No entendí el monto. Decime de nuevo, por ejemplo: "gasté 5000 pesos en el super"');
    return;
  }

  var categorias = getCategorias();
  var categoriaValida = categorias.some(function (c) { return c.nombre === parsed.categoria; });
  if (!parsed.categoria || !categoriaValida) {
    var lista = categorias.map(function (c) { return c.nombre; }).join(', ');
    tgSendMessage_(chatId, 'No reconocí la categoría. Las categorías válidas son: ' + lista + '. Probá de nuevo aclarando una de esas.');
    return;
  }

  var pagadoPor = parsed.pagadoPor;
  if (!pagadoPor || (pagadoPor !== 'Fran' && pagadoPor !== 'Marti')) {
    pagadoPor = persona;
  }

  var fecha = parsed.fecha || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var draft = {
    categoria: parsed.categoria,
    monto: Number(parsed.monto),
    pagadoPor: pagadoPor,
    fecha: fecha,
    nota: parsed.nota || ''
  };

  CacheService.getScriptCache().put('tg_pending_' + chatId, JSON.stringify(draft), 1800);

  var montoFormateado = '$' + Math.round(draft.monto).toLocaleString('es-AR');
  var texto = '¿Confirmás este gasto?\n\n' +
    '💰 ' + montoFormateado + '\n' +
    '🏷️ ' + draft.categoria + '\n' +
    '👤 ' + draft.pagadoPor + '\n' +
    '📅 ' + draft.fecha +
    (draft.nota ? '\n📝 ' + draft.nota : '');

  tgSendMessage_(chatId, texto, {
    inline_keyboard: [[
      { text: '✅ Confirmar', callback_data: 'confirm' },
      { text: '❌ Cancelar', callback_data: 'cancel' }
    ]]
  });
}

/**
 * Procesa el click en los botones de confirmación/cancelación.
 */
function handleTelegramCallback_(callbackQuery) {
  var chatId = callbackQuery.message.chat.id;
  var persona = resolvePersonaPorChatId_(chatId);
  if (!persona) return;

  var cache = CacheService.getScriptCache();
  var key = 'tg_pending_' + chatId;
  var raw = cache.get(key);

  tgAnswerCallbackQuery_(callbackQuery.id);

  if (!raw) {
    tgEditMessageText_(chatId, callbackQuery.message.message_id, 'Esto ya expiró, mandá el audio de nuevo.');
    return;
  }

  if (callbackQuery.data === 'confirm') {
    var draft = JSON.parse(raw);
    cache.remove(key);
    addMovimiento(draft);
    tgEditMessageText_(chatId, callbackQuery.message.message_id, '✅ Guardado: $' + draft.monto + ' en ' + draft.categoria);
    return;
  }

  if (callbackQuery.data === 'cancel') {
    cache.remove(key);
    tgEditMessageText_(chatId, callbackQuery.message.message_id, '❌ Cancelado.');
    return;
  }
}

/**
 * Transcribe un audio con Groq Whisper. Devuelve '' si falla.
 */
function groqTranscribe_(audioBlob) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');
  audioBlob.setName('audio.ogg');
  var response = UrlFetchApp.fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: {
      file: audioBlob,
      model: 'whisper-large-v3',
      language: 'es',
      response_format: 'json'
    },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('groqTranscribe_ error ' + response.getResponseCode() + ': ' + response.getContentText());
    return '';
  }

  var json = JSON.parse(response.getContentText());
  return json.text || '';
}

/**
 * Usa un LLM de Groq para extraer los datos del gasto de la transcripción.
 * Devuelve null si no se pudo parsear.
 */
function groqParseExpense_(transcript, categorias, personas) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');
    var nombresCategorias = categorias.map(function (c) { return c.nombre; }).join(', ');
    var nombresPersonas = personas.join(', ');
    var hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    var systemPrompt =
      'Sos un asistente que extrae datos de un gasto a partir de una transcripción de audio en español rioplatense.\n' +
      'Categorías válidas (elegí EXACTAMENTE uno de estos nombres, tal cual, o null si ninguno encaja): ' + nombresCategorias + '.\n' +
      'Personas válidas: ' + nombresPersonas + '.\n' +
      'Si se menciona quién pagó, usá ese nombre exacto; si no se menciona, dejá "pagadoPor" en null.\n' +
      'Si se menciona una fecha relativa ("ayer", "anteayer", "el lunes"), resolvela a formato yyyy-MM-dd sabiendo que hoy es ' + hoy + '. Si no se menciona fecha, dejá "fecha" en null.\n' +
      'El monto debe ser un número (sin símbolo de moneda ni puntos de miles), interpretando correctamente expresiones como "cinco mil", "10 lucas" (=10000), "2 palos" (=2000000), etc.\n' +
      'Devolvé SOLO un JSON con esta forma exacta, sin texto adicional: { "monto": number|null, "categoria": string|null, "pagadoPor": string|null, "fecha": string|null, "nota": string|null }. "nota" es una nota corta opcional (ej: "verdulería", "nafta YPF") si se menciona un detalle relevante además del monto/categoría, si no null.';

    var response = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + apiKey },
      contentType: 'application/json',
      payload: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript }
        ],
        temperature: 0,
        response_format: { type: 'json_object' }
      }),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('groqParseExpense_ error ' + response.getResponseCode() + ': ' + response.getContentText());
      return null;
    }

    var responseJson = JSON.parse(response.getContentText());
    return JSON.parse(responseJson.choices[0].message.content);
  } catch (err) {
    Logger.log('groqParseExpense_ excepción: ' + err.message);
    return null;
  }
}

/**
 * Arma la URL de un método de la API de Telegram usando el token guardado
 * en Script Properties.
 */
function tgApiUrl_(method) {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  return 'https://api.telegram.org/bot' + token + '/' + method;
}

function tgSendMessage_(chatId, text, replyMarkup) {
  var response = UrlFetchApp.fetch(tgApiUrl_('sendMessage'), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text: text,
      reply_markup: replyMarkup || undefined
    }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    Logger.log('tgSendMessage_ error ' + response.getResponseCode() + ': ' + response.getContentText());
  }
}

function tgAnswerCallbackQuery_(callbackQueryId, text) {
  var response = UrlFetchApp.fetch(tgApiUrl_('answerCallbackQuery'), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: text || ''
    }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    Logger.log('tgAnswerCallbackQuery_ error ' + response.getResponseCode() + ': ' + response.getContentText());
  }
}

function tgEditMessageText_(chatId, messageId, text) {
  var response = UrlFetchApp.fetch(tgApiUrl_('editMessageText'), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: text
    }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    Logger.log('tgEditMessageText_ error ' + response.getResponseCode() + ': ' + response.getContentText());
  }
}

function tgGetFilePath_(fileId) {
  var response = UrlFetchApp.fetch(tgApiUrl_('getFile') + '?file_id=' + encodeURIComponent(fileId), {
    muteHttpExceptions: true
  });
  var json = JSON.parse(response.getContentText());
  return json.result.file_path;
}

function tgDownloadFile_(filePath) {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  var url = 'https://api.telegram.org/file/bot' + token + '/' + filePath;
  return UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getBlob();
}

/**
 * Punto de entrada del trigger de tiempo (cada 1 minuto). Apps Script no
 * puede recibir webhooks de Telegram (las URLs /exec devuelven un 302 y
 * Telegram no sigue redirects), así que en vez de eso hacemos polling:
 * le preguntamos a Telegram por updates nuevos con getUpdates.
 *
 * Nunca debe tirar una excepción hacia afuera: la dispara un trigger
 * automático sin que nadie esté mirando.
 */
function pollTelegramUpdates_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;

  try {
    var startTime = Date.now();
    var maxDurationMs = 300000;
    var longPollTimeoutSec = 25;

    while (Date.now() - startTime < maxDurationMs) {
      try {
        var props = PropertiesService.getScriptProperties();
        var offset = Number(props.getProperty('TELEGRAM_UPDATE_OFFSET') || '0');

        var response;
        try {
          response = UrlFetchApp.fetch(
            tgApiUrl_('getUpdates') + '?offset=' + offset + '&timeout=' + longPollTimeoutSec,
            { muteHttpExceptions: true }
          );
        } catch (fetchErr) {
          Logger.log('pollTelegramUpdates_ error de fetch: ' + fetchErr.message);
          continue;
        }

        if (response.getResponseCode() !== 200) {
          Logger.log('pollTelegramUpdates_ error ' + response.getResponseCode() + ': ' + response.getContentText());
          continue;
        }

        var json;
        try {
          json = JSON.parse(response.getContentText());
        } catch (parseErr) {
          Logger.log('pollTelegramUpdates_ error parseando JSON: ' + parseErr.message);
          continue;
        }

        var updates = (json && json.result) || [];
        if (!updates.length) continue;

        var maxUpdateId = offset;
        updates.forEach(function (update) {
          try {
            handleTelegramUpdate_(update);
          } catch (updateErr) {
            Logger.log('pollTelegramUpdates_ error en update ' + update.update_id + ': ' + updateErr.message);
          }
          if (update.update_id > maxUpdateId) maxUpdateId = update.update_id;
        });

        props.setProperty('TELEGRAM_UPDATE_OFFSET', String(maxUpdateId + 1));
      } catch (iterationErr) {
        Logger.log('pollTelegramUpdates_ excepción: ' + iterationErr.message);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Crea el trigger de tiempo que llama a pollTelegramUpdates_ cada 1 minuto.
 * Correr una sola vez a mano desde el editor de Apps Script.
 */
function crearTriggerPollingTelegram_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'pollTelegramUpdates_') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('pollTelegramUpdates_').timeBased().everyMinutes(1).create();
}
