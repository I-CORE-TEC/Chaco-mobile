// ¿El teclado en pantalla está tapando la mitad inferior? Sin imports a propósito: se prueba suelto.
// En web no hay evento de teclado: se lo deduce de que el viewport visible se achicó mucho con un
// campo de texto enfocado (un cambio de barra de URL no alcanza ni cuenta sin campo enfocado).
export const FRACCION_TECLADO_WEB = 0.75;

export const tecladoAbiertoWeb = ({ alturaMaxima, alturaVisible, enfocadoEditable }) =>
  !!enfocadoEditable && alturaMaxima > 0 && alturaVisible < alturaMaxima * FRACCION_TECLADO_WEB;
