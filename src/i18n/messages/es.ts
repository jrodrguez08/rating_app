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
    lifecycleUnavailable: {
      status: "Servicio no disponible",
      title: "No pudimos cargar el partido",
      description:
        "La información del partido no está disponible temporalmente. Intenta de nuevo en unos minutos.",
      privacy:
        "Tus calificaciones y los resultados privados permanecen protegidos.",
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
      results: {
        label: "Resultados finales",
        title: "Resultados de la comunidad",
        description:
          "La votaci\u00f3n cerr\u00f3 y los resultados ya est\u00e1n disponibles.",
        action: "Ver resultados",
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
  matches: {
    eyebrow: "Temporada de Herediano",
    title: "Partidos",
    introduction: "Próximos partidos, marcadores y resultados recientes.",
    featured: "Partido destacado",
    recent: "Partidos recientes",
    upcoming: "Próximos partidos",
    noRecent: "Todavía no hay partidos finalizados en el archivo.",
    noUpcoming: "No hay próximos partidos confirmados.",
    unavailableTitle: "No pudimos cargar los partidos",
    unavailableDescription: "El archivo no está disponible temporalmente.",
    detailUnavailable: "No pudimos cargar este partido.",
    scheduled: "Próximo partido",
    live: "En vivo",
    final: "Final",
    preparing: "Preparando calificaciones",
    preparingDescription: "Estamos preparando las calificaciones.",
    votingOpen: "Calificaciones abiertas",
    votingDescription: "La ventana de calificación de dos horas está abierta.",
    resultsAvailable: "Resultados disponibles",
    resultsDescription:
      "La votación cerró y los resultados de la comunidad están disponibles.",
    noRating: "Sin votación de Rating App",
    rate: "Calificar partido",
    results: "Ver resultados",
    details: "Ver partido",
    back: "Volver a partidos",
    goals: "Goles confirmados",
    goal: "Gol",
    trackedTeamGoal: "Gol de Herediano",
    opponentGoal: "Gol del rival",
    liveDescription:
      "Las calificaciones estarán disponibles después del final y la confirmación de participantes.",
    scheduledDescription:
      "La votación se habilitará después del partido cuando los participantes estén confirmados.",
    historicalDescription:
      "Este partido forma parte del archivo, aunque no haya tenido votación en Rating App.",
  },
  results: {
    eyebrow: "Resultados de la comunidad",
    title: "Resultados del partido",
    versus: "VS",
    final: "FINAL",
    mvp: "MVP",
    coMvp: "MVP compartido",
    players: "Clasificaci\u00f3n de jugadores",
    coach: "Director t\u00e9cnico",
    basedOnOne: "Basado en 1 voto",
    basedOnMany: "Basado en {count} votos",
    rating: "Calificaci\u00f3n de {name}: {rating}",
    lockedTitle: "Resultados bloqueados",
    lockedDescription:
      "Los resultados estar\u00e1n disponibles cuando cierre la votaci\u00f3n.",
    preparingTitle: "Preparando resultados",
    preparingDescription: "Estamos preparando los resultados.",
    unavailableTitle: "Resultados no disponibles",
    unavailableDescription: "No pudimos cargar este partido.",
    noVotesTitle: "Sin resultados",
    noVotesDescription: "No hubo suficientes votos para mostrar resultados.",
    backHome: "Volver al inicio",
  },
  footer: {
    supporting: "Creado para aficionados. Listo para crecer club por club.",
  },
} as const;
