#!/usr/bin/env bash
# Downloads a Material Symbols Rounded subset (filled, weight 500) containing only the icons LockedIn uses.
# Re-run after adding an icon anywhere in the app: add it to ICONS below, then commit src/fonts/material-symbols.woff2.
set -euo pipefail
cd "$(dirname "$0")/.."
ICONS="add insights local_fire_department trending_up wb_sunny event_repeat notifications_off link lock remove arrow_forward bolt check_circle devices edit_calendar expand_more flag person_add play_circle schedule signal_cellular_alt add_box add_circle admin_panel_settings alarm arrow_back campaign download rocket_launch school send touch_app waving_hand bedtime calendar_month calendar_view_week call check chevron_left chevron_right close coffee directions_bike directions_run edit install_mobile ios_share notifications_active favorite fitness_center groups logout mail menu_book repeat restaurant self_improvement settings shopping_cart shower view_day water_drop work"
NAMES=$(echo $ICONS | tr ' ' '\n' | sort | paste -sd, -)
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CSS=$(curl -fsS -A "$UA" "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,500,1,0&icon_names=${NAMES}&display=block")
URL=$(echo "$CSS" | grep -o 'https://fonts.gstatic.com[^)]*' | head -1)
curl -fsS -A "$UA" -o src/fonts/material-symbols.woff2 "$URL"
ls -l src/fonts/material-symbols.woff2
