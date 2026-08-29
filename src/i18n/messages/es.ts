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
          "La ventana de dos horas est\u00e1 activa. Env\u00eda una calificaci\u00f3n completa antes de que cierre.",
        action: "Calificar partido",
        submitted: "Calificaci\u00f3n enviada",
        checking: "Preparando tu sesi\u00f3n...",
        sessionError: "No pudimos preparar tu sesi\u00f3n. Intenta de nuevo.",
      },
    },
  },
  ballot: {
    eyebrow: "Calificaci\u00f3n del partido",
    title: "Califica al equipo",
    versus: "VS",
    closes: "La votaci\u00f3n cierra a las {time}",
    players: "Jugadores",
    coach: "Director t\u00e9cnico",
    substitute: "SUP",
    ratingLabel: "Calificaci\u00f3n para {name}",
    progress: "{completed} / {total} calificados",
    submit: "Enviar calificaci\u00f3n",
    checking: "Preparando tu boleta...",
    submitting: "Enviando...",
    confirmTitle: "Confirmar calificaci\u00f3n",
    confirmDescription:
      "Despu\u00e9s de enviar no podr\u00e1s cambiar tus calificaciones.",
    confirm: "Confirmar y enviar",
    cancel: "Revisar calificaciones",
    submittedTitle: "Calificaci\u00f3n enviada",
    submittedDescription: "Tus votos quedaron registrados.",
    closedTitle: "La votaci\u00f3n termin\u00f3",
    closedDescription: "Ya no se aceptan calificaciones para este partido.",
    notOpenTitle: "La votaci\u00f3n no est\u00e1 disponible",
    notOpenDescription:
      "El partido y sus participantes deben estar listos antes de calificar.",
    unavailableTitle: "No pudimos cargar la papeleta",
    unavailableDescription:
      "Los participantes o el director t\u00e9cnico no est\u00e1n disponibles.",
    sessionError: "No pudimos preparar tu sesi\u00f3n. Intenta de nuevo.",
    invalidError: "Completa todas las calificaciones del 1 al 10.",
    submitError: "No pudimos enviar tu calificaci\u00f3n. Intenta de nuevo.",
    backHome: "Volver al inicio",
  },
  footer: {
    supporting: "Creado para aficionados. Listo para crecer club por club.",
  },
} as const;
