# Seguridad del acceso (punto 44 de PARA-DECIDIR)

## El problema

La base de datos (Firestore) tiene una sola regla: leer y escribir todo, sin
condiciones. El usuario y la clave se controlaban solo en el teléfono. Quien
conozca el proyecto de Firebase puede leer clientes, saldos y claves, o borrar
datos, sin pasar por el sistema.

## Cómo queda

- Cada teléfono inicia sesión con una **cuenta de Firebase** (Authentication,
  mail y contraseña). El mail es interno y lo arma el sistema; la persona sigue
  escribiendo su usuario y su clave de siempre.
- La base deja pasar solo a las cuentas que figuran en `accesos/{uid}` con
  `activo: true`. Ese permiso lo escribe únicamente un Director. Crearse una
  cuenta no alcanza.
- El **Operario** entra con el **PIN del depósito** (6 números), que fija un
  Director en Usuarios → "PIN del depósito". Se pide una vez por teléfono.
- Cambiar una clave (o el PIN) crea una cuenta nueva y le quita el acceso a la
  anterior: los teléfonos que seguían con la vieja vuelven al ingreso.

Colecciones nuevas (no se tocó ningún campo existente):

| Colección | Qué guarda | Quién la lee |
|---|---|---|
| `accesos/{uid}` | `usuario`, `mostrar`, `rol`, `nombre`, `activo`, `gen`, `creado` | la propia cuenta; los Directores, todas |
| `ingreso/{id}` | `gen`: número de la cuenta vigente del usuario (`d-<usuario>` u `operario`) | cualquiera, de a un documento (hace falta antes de ingresar) |

Código: `src/js/cuenta.js` (sesión de la cuenta y pase para Firestore),
`src/js/fb.js` y `src/js/fb-compat.js` (se lo pasan a Firestore),
`src/index.html` (ingreso, usuarios, PIN), `src/js/shell.js` (si la base
rechaza al teléfono, lo manda al ingreso) y `firestore.rules`.

No se usa la librería de Auth de Firebase: al abrir cada página consulta al
servidor y con mala señal deja todo esperando hasta un minuto. `cuenta.js` lee
la sesión del teléfono al instante y habla con el mismo servicio oficial de
cuentas (API REST de Identity Toolkit). Se engancha a Firestore por el
componente interno `auth-internal` de Firebase 10.14.1: si algún día se
actualiza Firebase, correr `tests/acceso.test.mjs` antes de publicar.

## Las tres etapas

1. **Publicar esta versión con la base todavía abierta.** Nada cambia a la
   vista. Cada Director, la primera vez que ingresa, queda con su cuenta y su
   permiso. A los que tenían la sesión recordada se les pide ingresar de nuevo
   una vez. Un Director carga el PIN del depósito y cada teléfono del depósito
   lo pone una vez.
2. **Proteger la base.** Cuando todos ingresaron con la versión nueva, se pega
   el contenido de `firestore.rules` en Firebase → Firestore → Reglas →
   Publicar. Volver atrás es pegar la regla anterior:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```

   Antes de este paso, revisar en Firestore que `accesos` tenga un documento
   activo por cada Director que usa el sistema y uno con `rol: "operario"`. El
   que no figure no va a poder entrar: otro Director le cambia la clave desde
   Usuarios y con eso le queda la cuenta.
3. **Ajustar por rol** (pendiente): limitar al Operario a lo del depósito,
   sacar el ingreso viejo por lista de usuarios y borrar los `passwordHash`.

## Lo que hay que saber

- Mientras la base esté abierta (etapas 1 y antes), la protección todavía no
  existe: esta versión solo prepara las cuentas.
- Con la base protegida, un usuario nuevo o un cambio de clave necesitan señal.
- El primer Director "automático" (base sin usuarios) deja de existir con la
  base protegida: los usuarios los crea otro Director.
- En Firebase → Authentication conviene dejar habilitado solo "Correo
  electrónico/contraseña".
