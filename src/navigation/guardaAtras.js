// Botón Atrás del navegador en la PWA. La app navega por estado, sin historial propio: sin esto,
// Atrás sale del sitio y se pierde la pantalla. Mientras hay una pantalla a la que volver se deja
// una entrada de historial («marca»); al consumirla, el navegador no se va y la app retrocede.
// Sin imports a propósito: se prueba suelto.
export const crearGuardaWeb = (win, { alAtras, alCambiar } = {}) => {
  let armado = false;
  // Lo que la app quiere (hay pantalla anterior) y lo que el historial tiene (`armado`) pueden
  // diferir un instante: quitar la marca es un `history.back()` que el navegador resuelve después.
  let querido = false;
  // Retrocesos que hizo la propia app para quitar la marca y cuyo `popstate` todavía no llegó.
  let propios = 0;

  const conciliar = () => {
    // Con un retroceso propio en camino no se toca el historial: ese `popstate` se llevaría la
    // marca nueva y `armado` quedaría en true sin entrada.
    if (propios > 0) return;
    if (querido && !armado) {
      win.history.pushState({ nodoAtras: true }, '');
      armado = true;
    } else if (!querido && armado) {
      armado = false;
      propios += 1;
      win.history.back();
    }
  };

  const alPop = () => {
    if (propios > 0) {
      propios -= 1;
      if (propios === 0) conciliar();
      return;
    }
    if (!armado) return;
    armado = false;
    if (alAtras) alAtras();
    // La pantalla pudo cambiar o no: quien llama vuelve a sincronizar la marca.
    if (alCambiar) alCambiar();
  };
  win.addEventListener('popstate', alPop);

  return {
    sincronizar(hayAdondeVolver) {
      querido = !!hayAdondeVolver;
      conciliar();
    },
    // No se toca el historial: otro módulo puede estar montando su marca en este mismo instante.
    liberar() {
      win.removeEventListener('popstate', alPop);
      armado = false;
      querido = false;
    },
  };
};
