// Botón Atrás del navegador en la PWA. La app navega por estado, sin historial propio: sin esto,
// Atrás sale del sitio y se pierde la pantalla. Mientras hay una pantalla a la que volver se deja
// una entrada de historial («marca»); al consumirla, el navegador no se va y la app retrocede.
// Sin imports a propósito: se prueba suelto.
export const crearGuardaWeb = (win, { alAtras, alCambiar } = {}) => {
  let armado = false;
  // Retrocesos que hace la propia app (para quitar la marca) y que no son del usuario.
  let propios = 0;

  const alPop = () => {
    if (propios > 0) { propios -= 1; return; }
    if (!armado) return;
    armado = false;
    if (alAtras) alAtras();
    // La pantalla pudo cambiar o no: quien llama vuelve a sincronizar la marca.
    if (alCambiar) alCambiar();
  };
  win.addEventListener('popstate', alPop);

  return {
    sincronizar(hayAdondeVolver) {
      if (hayAdondeVolver && !armado) {
        win.history.pushState({ nodoAtras: true }, '');
        armado = true;
      } else if (!hayAdondeVolver && armado) {
        armado = false;
        propios += 1;
        win.history.back();
      }
    },
    // No se toca el historial: otro módulo puede estar montando su marca en este mismo instante.
    liberar() {
      win.removeEventListener('popstate', alPop);
      armado = false;
    },
  };
};
