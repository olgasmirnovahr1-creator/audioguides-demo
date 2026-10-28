/*
  ТЕСТОВЫЕ КОДЫ — ТОЛЬКО ДЛЯ ПРОВЕРКИ.
  Этот файл видит любой, кто откроет сайт, поэтому для настоящих продаж он НЕ годится.
  На шаге 5 его заменит сервер: коды будут создаваться при оплате и проверяться там.

  Поля:
    code    — сам код (вводить можно маленькими буквами, без дефисов и пробелов)
    tours   — какие экскурсии открывает; "all" — все (абонемент)
    months / days — срок доступа, считается С ПЕРВОГО ВВОДА кода
    type    — "purchase" (покупка), "subscription" (абонемент), "promo" (общий промокод), "single" (одноразовый)
    test    — особые случаи, чтобы посмотреть сообщения об ошибках
*/
window.TEST_CODES = [
  // Универсальный код для проверки: открывает все экскурсии на год
  { code: "TEST", type: "test", tours: "all", months: 12 },

  { code: "SMERTI-2026", type: "purchase", tours: ["neobychnye-smerti"], months: 6 },
  { code: "KVEST-0001", type: "purchase", tours: ["tayna-bulvarov"], months: 6 },
  { code: "ABONEMENT", type: "subscription", tours: "all", days: 30 },
  { code: "PROBA", type: "promo", tours: ["zaryadye"], months: 1 },
  { code: "FREE-0001", type: "single", tours: ["sokrovishcha-vdnh"], months: 6 },

  // Особые случаи — посмотреть, что увидит турист
  { code: "ISTEK", type: "purchase", tours: ["neobychnye-smerti"], months: 6, test: "expired" },
  { code: "ZANYAT", type: "purchase", tours: ["neobychnye-smerti"], months: 6, test: "devices" },
  { code: "ISPOLZOVAN", type: "single", tours: ["sokrovishcha-vdnh"], months: 6, test: "used" }
];
