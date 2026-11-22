// Mismas reglas que el back (`programas/validacion_contacto.normalizar_telefono`, Cambio 527): solo
// dígitos, espacios, `+`, `-` y paréntesis, con 8 a 15 dígitos. Vacío no se valida: es opcional.
export const MENSAJE_TELEFONO_INVALIDO = 'Ingresá un teléfono de 8 a 15 dígitos.';
export const LARGOS_TELEFONO = [8, 15];

export const telefonoValido = (valor) => {
  const texto = String(valor ?? '').trim();
  if (!texto) return true;
  if (!/^[0-9\s+\-()]+$/.test(texto)) return false;
  const digitos = texto.replace(/\D/g, '').length;
  return digitos >= LARGOS_TELEFONO[0] && digitos <= LARGOS_TELEFONO[1];
};

// El mensaje de error, o null si el teléfono está vacío o es válido.
export const errorDeTelefono = (valor) => (telefonoValido(valor) ? null : MENSAJE_TELEFONO_INVALIDO);
