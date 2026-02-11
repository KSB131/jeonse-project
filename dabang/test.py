import undetected_chromedriver as uc
import time

options = uc.ChromeOptions()
options.add_argument("--disable-blink-features=AutomationControlled")
options.add_argument("--start-maximized")

driver = None
try:
    driver = uc.Chrome(version_main=144, options=options)  # 🔥 핵심
    driver.get("https://www.dabangapp.com")
    time.sleep(5)
    print("TITLE:", driver.title)
finally:
    if driver:
        driver.quit()
