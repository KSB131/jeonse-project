from flask import Flask, jsonify
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time
import requests

# Kakao REST API 키
KAKAO_REST_KEY = "c8c008a45ef3651d2b59b3684fd62179"

app = Flask(__name__)

def get_coordinates(address):
    """주소 → 위도/경도 변환"""
    url = "https://dapi.kakao.com/v2/local/search/address.json"
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_KEY}"}
    params = {"query": address}
    try:
        res = requests.get(url, headers=headers, params=params)
        data = res.json()
        if data["documents"]:
            y = float(data["documents"][0]["y"])
            x = float(data["documents"][0]["x"])
            return y, x
        return None, None
    except:
        return None, None

@app.route("/api/dabang")
def get_dabang():
    # 🔹 지도 기반 매물 URL
    url = "https://www.dabangapp.com/map/apt?m_lat=35.1617451&m_lng=126.8667353&m_zoom=13&detail_type=room&detail_id=694a398f001cc40d654c1ca1"

    # 🔹 Selenium 브라우저 실행
    browser = webdriver.Chrome(service=Service(ChromeDriverManager().install()))
    browser.get(url)

    wait = WebDriverWait(browser, 10)

    # 🔹 매물 카드가 로딩될 때까지 대기
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, "div.css-1x93jz0")))
    time.sleep(2)

    # 🔹 모든 매물 카드 수집
    cards = browser.find_elements(By.CSS_SELECTOR, "div.css-1x93jz0")
    rooms = []

    for card in cards:
        try:
            # 매물 클릭 → 상세 팝업 열기
            card.click()
            time.sleep(1)  # 팝업 로딩 대기

            # 팝업 내 상세정보 로딩
            wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "div.css-1x0s5sq")))  # 팝업 컨테이너

            # 정보 추출
            popup = browser.find_element(By.CSS_SELECTOR, "div.css-1x0s5sq")

            title = popup.find_element(By.CSS_SELECTOR, "div.css-1h3p8w3").text
            price = popup.find_element(By.CSS_SELECTOR, "span.css-14gy7wr").text
            address_text = popup.find_element(By.CSS_SELECTOR, "div.css-1b6p9rs").text

            # 상세정보 key:value 리스트
            details = {}
            detail_rows = popup.find_elements(By.CSS_SELECTOR, "div.css-1l8s5we")  # 상세 row
            for row in detail_rows:
                try:
                    key = row.find_element(By.CSS_SELECTOR, "div.css-17plrmr").text.strip()
                    value = row.find_element(By.CSS_SELECTOR, "div.css-1o7ew2x").text.strip()
                    details[key] = value
                except:
                    continue

            # 좌표 변환
            lat, lng = get_coordinates(address_text)
            if lat is None or lng is None:
                continue

            rooms.append({
                "title": title,
                "price": price,
                "address": address_text,
                "lat": lat,
                "lng": lng,
                "details": details  # 평수, 층수, 평단가, 관리비 등
            })

            # 팝업 닫기
            close_btn = popup.find_element(By.CSS_SELECTOR, "button.css-1xynqvz")
            close_btn.click()
            time.sleep(0.5)
        except Exception as e:
            print("오류:", e)
            continue

    browser.quit()
    return jsonify({"items": rooms})

if __name__ == "__main__":
    app.run(port=3001, debug=True)
