-- Run on NEW (US) project after copy. Compare these counts to the OLD (Sydney) project
-- (run the same SELECTs there). Counts must match for every table before you trust cutover.

SELECT 'Session' AS table_name, COUNT(*) AS rows FROM "Session"
UNION ALL SELECT 'Shop', COUNT(*) FROM "Shop"
UNION ALL SELECT 'Configurator', COUNT(*) FROM "Configurator"
UNION ALL SELECT 'ConfiguratorStep', COUNT(*) FROM "ConfiguratorStep"
UNION ALL SELECT 'OptionGroup', COUNT(*) FROM "OptionGroup"
UNION ALL SELECT 'Option', COUNT(*) FROM "Option"
UNION ALL SELECT 'ConditionalRule', COUNT(*) FROM "ConditionalRule"
UNION ALL SELECT 'Addon', COUNT(*) FROM "Addon"
UNION ALL SELECT 'ThemeSetting', COUNT(*) FROM "ThemeSetting"
UNION ALL SELECT 'Analytics', COUNT(*) FROM "Analytics"
UNION ALL SELECT 'SavedConfiguration', COUNT(*) FROM "SavedConfiguration"
ORDER BY table_name;
