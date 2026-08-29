export const esMessages = {
  metadata: {
    title: "Rating App",
    description:
      "Calificaciones de aficionados para los jugadores y entrenadores que marcaron el partido.",
  },
  common: {
    language: "Idioma",
    spanish: "Español",
    english: "English",
  },
  accessibility: {
    skipToContent: "Ir al contenido",
    appHome: "Inicio de Rating App",
  },
  navigation: {
    label: "Navegación principal",
    home: "Inicio",
    matches: "Partidos",
    players: "Jugadores",
  },
  home: {
    communityEyebrow: "Comunidad inicial de aficionados",
    introduction:
      "Califica a los jugadores y al director técnico después del pitazo final. La primera ventana de calificación aparecerá aquí cuando un partido esté listo.",
    noActiveRating: {
      status: "Votación cerrada",
      title: "No hay una calificación activa",
      description:
        "La próxima calificación aparecerá después de un partido. Solo los jugadores que participaron y el director técnico serán elegibles para tu papeleta.",
      privacy:
        "Los resultados permanecen ocultos mientras la votación está abierta para mantener cada calificación independiente.",
    },
    matchLifecycle: {
      versus: "VS",
      upcoming: {
        label: "Pr\u00f3ximo partido",
        title: "Pr\u00f3ximo partido",
        description:
          "La votaci\u00f3n se abrir\u00e1 cuando finalice el partido y los participantes est\u00e9n confirmados.",
      },
      live: {
        label: "En juego",
        title: "Partido en juego",
        description: "Vuelve al finalizar para calificar al equipo.",
      },
      preparing: {
        label: "Partido finalizado",
        title: "Preparando la votaci\u00f3n",
        description:
          "Estamos confirmando los participantes y el director t\u00e9cnico antes de abrir la votaci\u00f3n.",
      },
      ready: {
        label: "Votaci\u00f3n disponible",
        title: "El partido est\u00e1 listo para calificar",
        description:
          "La ventana de dos horas est\u00e1 activa. La papeleta se habilitar\u00e1 en el siguiente hito.",
      },
    },
  },
  footer: {
    supporting: "Creado para aficionados. Listo para crecer club por club.",
  },
} as const;
