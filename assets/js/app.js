/* ==========================================================================
   Агропромпарк «Южный» — поведение страницы
   Пружины вместо фиксированных анимаций: любое движение можно прервать
   и развернуть, оно стартует с текущего значения и сохраняет скорость.
   ========================================================================== */

(() => {
  "use strict";

  const root = document.documentElement;
  root.classList.add("js");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  // Номер WhatsApp магазина — ЕДИНСТВЕННОЕ место, где его нужно поменять (формат 79XXXXXXXXX, без плюса).
  // Подставляется во все ссылки wa.me на сайте.
  const WHATSAPP_NUMBER = "70000000000";
  document.querySelectorAll('a[href*="wa.me/"]').forEach((a) => {
    a.href = a.href.replace(/wa\.me\/\d+/, "wa.me/" + WHATSAPP_NUMBER);
  });

  // Тактильный отклик — только там, где действие «зафиксировалось» (Android; на iOS безвредно игнорируется)
  const haptic = (ms = 8) => {
    if (!reduceMotion.matches && navigator.vibrate) navigator.vibrate(ms);
  };

  // iOS показывает :active только при наличии обработчика touchstart
  document.addEventListener("touchstart", () => {}, { passive: true });

  /* ------------------------------------------------------------------------
     Пружина: параметры как у Apple — damping (1 = без перелёта) и response (сек)
     ------------------------------------------------------------------------ */
  class Spring {
    constructor(value, { damping = 1, response = 0.35 } = {}) {
      this.value = value;
      this.target = value;
      this.velocity = 0;
      this.configure({ damping, response });
    }
    configure({ damping = this.damping, response = this.response }) {
      this.damping = damping;
      this.response = response;
      this.k = Math.pow((2 * Math.PI) / response, 2);
      this.c = (4 * Math.PI * damping) / response;
    }
    step(dt) {
      // Полунеявный Эйлер мелкими шагами — стабильно при любом dt
      const h = 1 / 240;
      for (let t = 0; t < dt; t += h) {
        const s = Math.min(h, dt - t);
        const force = -this.k * (this.value - this.target) - this.c * this.velocity;
        this.velocity += force * s;
        this.value += this.velocity * s;
      }
    }
    get atRest() {
      return Math.abs(this.velocity) < 0.01 && Math.abs(this.value - this.target) < 0.01;
    }
    settle() {
      this.value = this.target;
      this.velocity = 0;
    }
  }

  // Один цикл requestAnimationFrame на группу пружин
  function driver(springs, render, onRest) {
    let raf = 0;
    let last = 0;
    const frame = (now) => {
      const dt = Math.min(0.064, (now - last) / 1000 || 0.016);
      last = now;
      let resting = true;
      for (const s of springs) {
        s.step(dt);
        if (!s.atRest) resting = false;
      }
      if (resting) springs.forEach((s) => s.settle());
      render();
      if (resting) {
        raf = 0;
        onRest && onRest();
      } else raf = requestAnimationFrame(frame);
    };
    return {
      kick() {
        if (reduceMotion.matches) {
          springs.forEach((s) => s.settle());
          render();
          onRest && onRest();
          return;
        }
        if (!raf) {
          last = performance.now();
          raf = requestAnimationFrame(frame);
        }
      },
      stop() {
        cancelAnimationFrame(raf);
        raf = 0;
      },
      get running() {
        return raf !== 0;
      },
    };
  }

  // Проекция инерции — где остановится элемент после броска (формула Apple)
  const project = (velocity, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate);

  // Резиновое сопротивление за границей
  const rubberband = (overshoot, dimension, c = 0.55) =>
    (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));

  /* ------------------------------------------------------------------------
     Шапка: становится матовой, когда контент уходит под неё
     ------------------------------------------------------------------------ */
  const header = document.querySelector(".header");
  const hero = document.querySelector(".hero");
  if (header) {
    const update = () => {
      const threshold = hero ? hero.offsetHeight * 0.55 : 8;
      header.classList.toggle("is-solid", window.scrollY > threshold);
    };
    update();
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
  }

  /* ------------------------------------------------------------------------
     Меню: раскрывается из точки, где находится кнопка
     ------------------------------------------------------------------------ */
  const menu = document.querySelector(".menu");
  if (menu) {
    const openers = document.querySelectorAll("[data-menu-open]");
    const closer = menu.querySelector("[data-menu-close]");
    let lastOpener = null;

    const setOpen = (open, opener) => {
      if (open) {
        lastOpener = opener || null;
        if (opener) {
          const r = opener.getBoundingClientRect();
          menu.style.setProperty("--menu-origin", `${r.left + r.width / 2}px ${r.top + r.height / 2}px`);
        }
        root.classList.add("menu-open");
        menu.classList.add("is-open");
        menu.removeAttribute("inert");
        menu.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
        openers.forEach((b) => b.setAttribute("aria-expanded", "true"));
        requestAnimationFrame(() => closer && closer.focus({ preventScroll: true }));
      } else {
        root.classList.remove("menu-open");
        menu.classList.remove("is-open");
        menu.setAttribute("inert", "");
        menu.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
        openers.forEach((b) => b.setAttribute("aria-expanded", "false"));
        lastOpener && lastOpener.focus({ preventScroll: true });
      }
    };

    openers.forEach((b) => b.addEventListener("click", () => setOpen(true, b)));
    closer && closer.addEventListener("click", () => setOpen(false));
    menu.addEventListener("click", (e) => {
      if (e.target.closest("a")) setOpen(false);
    });
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menu.classList.contains("is-open")) setOpen(false);
    });
  }

  /* ------------------------------------------------------------------------
     Главный экран: логотип уплывает медленнее здания — ощущение глубины
     ------------------------------------------------------------------------ */
  if (hero) {
    const brand = hero.querySelector(".hero__brand");
    const img = hero.querySelector(".hero__img");
    const scrollHint = hero.querySelector(".hero__scroll");
    let ticking = false;

    const paint = () => {
      ticking = false;
      if (reduceMotion.matches) return;
      const h = hero.offsetHeight;
      const y = Math.min(window.scrollY, h);
      const p = y / h;
      if (brand) {
        brand.style.transform = `translate(-50%, calc(-50% + ${y * 0.45}px)) scale(${1 - p * 0.08})`;
        brand.style.opacity = String(Math.max(0, 1 - p * 1.6));
      }
      if (img) img.style.transform = `translateY(${y * 0.18}px) scale(${1 + p * 0.06})`;
      if (scrollHint) scrollHint.style.opacity = String(Math.max(0, 1 - p * 4));
    };
    addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(paint);
        }
      },
      { passive: true }
    );
    paint();
  }

  /* ------------------------------------------------------------------------
     Мягкое появление блоков при прокрутке
     ------------------------------------------------------------------------ */
  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target;
          // Соседние блоки одной группы появляются каскадом; задержку убираем после появления, чтобы не тормозить отклик на нажатие
          const siblings = [...el.parentElement.children].filter((n) => n.classList.contains("reveal"));
          const delay = Math.min(siblings.indexOf(el), 6) * 70;
          if (delay && !reduceMotion.matches) {
            el.style.transitionDelay = delay + "ms";
            setTimeout(() => (el.style.transitionDelay = ""), delay + 1100);
          }
          el.classList.add("is-in");
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    reveals.forEach((el) => io.observe(el));
  } else reveals.forEach((el) => el.classList.add("is-in"));

  /* ------------------------------------------------------------------------
     Липкая кнопка WhatsApp прячется, когда видна основная
     ------------------------------------------------------------------------ */
  const dock = document.querySelector(".dock");
  const ask = document.querySelector(".ask");
  if (dock && ask && "IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => dock.classList.toggle("is-away", e.isIntersecting), {
      threshold: 0.35,
    }).observe(ask);
  }

  /* ------------------------------------------------------------------------
     Видео в карточках разделов: грузится и играет только при наведении мышью.
     На телефонах, при экономии трафика и отключённых анимациях остаётся фото.
     ------------------------------------------------------------------------ */
  if (
    matchMedia("(hover: hover) and (pointer: fine)").matches &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches &&
    !(navigator.connection && navigator.connection.saveData)
  ) {
    document.querySelectorAll(".pcard__video").forEach((video) => {
      const card = video.closest(".pcard");
      let hovered = false;
      video.addEventListener("playing", () => {
        if (hovered) video.classList.add("is-playing");
      });
      card.addEventListener("pointerenter", () => {
        hovered = true;
        video.currentTime = 0;
        const p = video.play();
        if (p) p.catch(() => {});
      });
      card.addEventListener("pointerleave", () => {
        hovered = false;
        video.classList.remove("is-playing");
        setTimeout(() => { if (!hovered) video.pause(); }, 350);
      });
    });
  }

  /* ------------------------------------------------------------------------
     Карусель категорий
     — пальцем листается нативно (инерция и доводка от браузера)
     — мышью тянется 1:1, после отпускания летит по инерции к ближайшей карточке
     — стрелки листают на ширину видимых карточек
     ------------------------------------------------------------------------ */
  document.querySelectorAll("[data-carousel]").forEach((carousel) => {
    const track = carousel.querySelector(".carousel__track");
    const cards = [...track.children];
    const section = carousel.closest("section");
    const prev = section.querySelector("[data-carousel-prev]");
    const next = section.querySelector("[data-carousel-next]");
    const inset = () => parseFloat(getComputedStyle(track).paddingLeft) || 0;
    const maxScroll = () => track.scrollWidth - track.clientWidth;
    // Точки, на которых карточки встают ровно по сетке
    const snaps = () => cards.map((c) => Math.min(maxScroll(), Math.max(0, c.offsetLeft - inset())));
    const nearest = (x) => snaps().reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a), 0);

    const updateNav = () => {
      if (!prev || !next) return;
      prev.disabled = track.scrollLeft < 4;
      next.disabled = track.scrollLeft > maxScroll() - 4;
    };
    updateNav();
    track.addEventListener("scroll", updateNav, { passive: true });
    addEventListener("resize", updateNav);

    // Плавная прокрутка пружиной — прерывается, если пользователь снова схватил
    const pos = new Spring(0, { damping: 1, response: 0.5 });
    const glide = driver([pos], () => (track.scrollLeft = pos.value), () => {
      track.classList.remove("is-dragging");
    });
    const glideTo = (x, velocity = 0) => {
      track.classList.add("is-dragging"); // снап выключен на время анимации
      pos.value = track.scrollLeft;
      pos.velocity = velocity;
      pos.target = Math.min(maxScroll(), Math.max(0, x));
      glide.kick();
    };

    const page = (dir) => {
      const step = track.clientWidth - inset() * 2;
      const snapsList = snaps();
      const target = track.scrollLeft + dir * step;
      // Ближайшая карточка в направлении листания
      const candidates = snapsList.filter((s) => (dir > 0 ? s > track.scrollLeft + 4 : s < track.scrollLeft - 4));
      const x = candidates.length ? candidates.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a)) : target;
      glideTo(x);
    };
    prev && prev.addEventListener("click", () => page(-1));
    next && next.addEventListener("click", () => page(1));

    // Перетаскивание мышью (тач и тачпад работают нативно)
    let drag = null;
    track.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      glide.stop();
      drag = { x: e.clientX, left: track.scrollLeft, hist: [{ x: e.clientX, t: e.timeStamp }], moved: false };
    });
    addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        track.classList.add("is-dragging");
      }
      let x = drag.left - dx;
      // Резиновое сопротивление за краями
      if (x < 0) x = -rubberband(-x, track.clientWidth);
      else if (x > maxScroll()) x = maxScroll() + rubberband(x - maxScroll(), track.clientWidth);
      track.scrollLeft = x;
      drag.hist.push({ x: e.clientX, t: e.timeStamp });
      if (drag.hist.length > 6) drag.hist.shift();
    });
    addEventListener("pointerup", () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved) return;
      const a = d.hist[0];
      const b = d.hist[d.hist.length - 1];
      const v = -((b.x - a.x) / Math.max(1, b.t - a.t)) * 1000; // px/с в координатах прокрутки
      glideTo(nearest(track.scrollLeft + project(v)), v);
    });
    // Клик после перетаскивания не должен срабатывать
    track.addEventListener("click", (e) => track.classList.contains("is-dragging") && e.preventDefault(), true);
  });

  /* ------------------------------------------------------------------------
     Просмотр фото
     — открывается из карточки и возвращается в неё (пространственная связь)
     — тянется пальцем 1:1, смахивание вниз закрывает, в стороны листает
     — скорость жеста передаётся в пружину, решение принимается по проекции
     ------------------------------------------------------------------------ */
  const lb = document.querySelector(".lightbox");
  const triggers = [...document.querySelectorAll("[data-lightbox]")];
  if (lb && triggers.length) {
    const scrim = lb.querySelector(".lightbox__scrim");
    const stage = lb.querySelector(".lightbox__stage");
    const img = lb.querySelector(".lightbox__img");
    const ui = lb.querySelector(".lightbox__ui");
    const caption = lb.querySelector(".lightbox__caption");
    const btnClose = lb.querySelector(".lightbox__close");
    const btnPrev = lb.querySelector(".lightbox__nav--prev");
    const btnNext = lb.querySelector(".lightbox__nav--next");

    const photos = triggers.map((t) => ({
      src: t.dataset.lightbox,
      alt: t.querySelector("img")?.alt || "",
      caption: t.dataset.caption || "",
      el: t,
    }));

    let index = 0;
    let open = false;
    let closing = false;
    let fit = { w: 0, h: 0, x: 0, y: 0 }; // итоговый размер и позиция фото

    // Пружины: сдвиг, масштаб, затемнение
    const sx = new Spring(0);
    const sy = new Spring(0);
    const ss = new Spring(1);
    const so = new Spring(0);
    const all = [sx, sy, ss, so];
    const setAll = (cfg) => all.forEach((s) => s.configure(cfg));

    const render = () => {
      img.style.transform = `translate(${fit.x + sx.value}px, ${fit.y + sy.value}px) scale(${ss.value})`;
      scrim.style.opacity = String(Math.max(0, Math.min(1, so.value)) * 0.92);
    };
    const anim = driver(all, render, () => {
      if (closing) finishClose();
    });

    const measure = (natW, natH) => {
      const pad = innerWidth < 760 ? 12 : 72;
      const maxW = innerWidth - pad * 2;
      const maxH = innerHeight - pad * 2 - (innerWidth < 760 ? 80 : 40);
      const k = Math.min(maxW / natW, maxH / natH);
      const w = Math.round(natW * k);
      const h = Math.round(natH * k);
      fit = { w, h, x: Math.round((innerWidth - w) / 2), y: Math.round((innerHeight - h) / 2) };
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
    };

    // Трансформация, при которой фото совпадает с превью на странице
    const fromThumb = (el) => {
      const r = (el.querySelector("img") || el).getBoundingClientRect();
      // Масштаб идёт от центра фото, поэтому совмещаем центры
      return {
        x: r.left + r.width / 2 - (fit.x + fit.w / 2),
        y: r.top + r.height / 2 - (fit.y + fit.h / 2),
        s: Math.max(r.width / fit.w, r.height / fit.h),
      };
    };

    const show = (i) => {
      index = (i + photos.length) % photos.length;
      const p = photos[index];
      img.src = p.src;
      img.alt = p.alt;
      caption.textContent = p.caption;
      caption.hidden = !p.caption;
    };

    const loadSize = () =>
      new Promise((resolve) => {
        if (img.complete && img.naturalWidth) return resolve();
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });

    async function openAt(i) {
      if (open) return;
      open = true;
      closing = false;
      show(i);
      await loadSize();
      measure(img.naturalWidth || 4, img.naturalHeight || 3);
      const t = fromThumb(photos[index].el);
      sx.value = t.x;
      sy.value = t.y;
      ss.value = t.s;
      so.value = 0;
      all.forEach((s) => (s.velocity = 0));
      setAll({ damping: 1, response: 0.42 });
      sx.target = 0;
      sy.target = 0;
      ss.target = 1;
      so.target = 1;
      photos[index].el.style.visibility = "hidden";
      lb.classList.add("is-open");
      lb.removeAttribute("aria-hidden");
      document.body.style.overflow = "hidden";
      render();
      anim.kick();
      ui.classList.add("is-visible");
      btnClose.focus({ preventScroll: true });
    }

    function close(velocity = { x: 0, y: 0 }) {
      if (!open || closing) return;
      closing = true;
      haptic(8);
      ui.classList.remove("is-visible");
      const t = fromThumb(photos[index].el);
      setAll({ damping: 1, response: 0.4 });
      sx.velocity = velocity.x;
      sy.velocity = velocity.y;
      sx.target = t.x;
      sy.target = t.y;
      ss.target = t.s;
      so.target = 0;
      anim.kick();
    }

    function finishClose() {
      closing = false;
      open = false;
      photos.forEach((p) => (p.el.style.visibility = ""));
      lb.classList.remove("is-open");
      lb.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      photos[index].el.focus({ preventScroll: true });
    }

    // Перелистывание: текущее фото улетает по инерции, новое въезжает с той же стороны
    function page(dir, velocity = 0) {
      if (!open || closing) return;
      haptic(6);
      const out = -dir * innerWidth;
      const leaving = { x: sx.value, v: velocity };
      anim.stop();
      // Короткий вылет старого кадра
      const fly = new Spring(leaving.x, { damping: 1, response: 0.28 });
      fly.velocity = leaving.v;
      fly.target = out;
      const flyAnim = driver([fly], () => {
        img.style.transform = `translate(${fit.x + fly.value}px, ${fit.y + sy.value}px) scale(${ss.value})`;
      }, async () => {
        photos[index].el.style.visibility = "";
        show(index + dir);
        photos[index].el.style.visibility = "hidden";
        await loadSize();
        measure(img.naturalWidth || 4, img.naturalHeight || 3);
        sx.value = -out * 0.6;
        sx.velocity = leaving.v * 0.5;
        sy.value = 0;
        sy.velocity = 0;
        ss.value = 1;
        setAll({ damping: 1, response: 0.36 });
        sx.target = 0;
        sy.target = 0;
        ss.target = 1;
        so.target = 1;
        render();
        anim.kick();
      });
      flyAnim.kick();
    }

    triggers.forEach((t, i) =>
      t.addEventListener("click", (e) => {
        e.preventDefault();
        openAt(i);
      })
    );
    btnClose.addEventListener("click", () => close());
    btnPrev.addEventListener("click", () => page(-1));
    btnNext.addEventListener("click", () => page(1));
    addEventListener("keydown", (e) => {
      if (!open) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") page(1);
      if (e.key === "ArrowLeft") page(-1);
    });
    addEventListener("resize", () => {
      if (!open || closing) return;
      measure(img.naturalWidth || 4, img.naturalHeight || 3);
      render();
    });

    // ---- Жесты ----
    let drag = null;
    const HYSTERESIS = 10;

    stage.addEventListener("pointerdown", (e) => {
      if (!open || closing || e.button > 0) return;
      stage.setPointerCapture(e.pointerId);
      // Хватаем фото там, где оно сейчас (даже посреди анимации)
      anim.stop();
      drag = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        ox: sx.value,
        oy: sy.value,
        axis: null,
        hist: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }],
        moved: false,
      };
    });

    stage.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      if (!drag.axis) {
        if (Math.hypot(dx, dy) < HYSTERESIS) return;
        drag.axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
        ui.classList.remove("is-visible");
      }
      drag.moved = true;
      drag.hist.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (drag.hist.length > 6) drag.hist.shift();

      if (drag.axis === "y") {
        sy.value = drag.oy + dy;
        sx.value = drag.ox + dx * 0.35;
        const p = Math.min(1, Math.abs(sy.value) / innerHeight);
        ss.value = 1 - p * 0.35;
        so.value = 1 - p * 1.4;
      } else {
        const edge = photos.length < 2;
        sx.value = edge ? rubberband(dx, innerWidth) : drag.ox + dx;
      }
      all.forEach((s) => (s.velocity = 0));
      render();
    });

    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (!d.moved) {
        // Тап по фону закрывает, тап по фото — ничего
        if (e.target === stage) close();
        else anim.kick();
        return;
      }
      const a = d.hist[0];
      const b = d.hist[d.hist.length - 1];
      const dt = Math.max(1, b.t - a.t) / 1000;
      const vx = (b.x - a.x) / dt;
      const vy = (b.y - a.y) / dt;

      if (d.axis === "y") {
        const projected = sy.value + project(vy);
        if (Math.abs(projected) > innerHeight * 0.22) return close({ x: vx, y: vy });
        setAll({ damping: 0.85, response: 0.35 }); // лёгкий отскок — жест имел инерцию
        sx.velocity = vx;
        sy.velocity = vy;
        sx.target = 0;
        sy.target = 0;
        ss.target = 1;
        so.target = 1;
        ui.classList.add("is-visible");
        return anim.kick();
      }

      const projected = sx.value + project(vx);
      ui.classList.add("is-visible");
      if (photos.length > 1 && Math.abs(projected) > innerWidth * 0.35) {
        return page(projected < 0 ? 1 : -1, vx);
      }
      setAll({ damping: 0.85, response: 0.35 });
      sx.velocity = vx;
      sx.target = 0;
      sy.target = 0;
      anim.kick();
    };
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
  }

  /* ------------------------------------------------------------------------
     Схема рынка
     — наведение подсвечивает здание, нажатие выбирает его
     — на компьютере карточка справа, на телефоне шторка снизу
     — шторка тянется пальцем 1:1, смахивание вниз закрывает (скорость + проекция)
     ------------------------------------------------------------------------ */
  const plan = document.querySelector("[data-plan]");
  if (plan) {
    // Содержимое зданий. Фото: положите файл в assets/img/buildings/ — оно подставится само,
    // пока файла нет, показывается фрагмент схемы.
    const BUILDINGS = {
      c1: {
        title: "Корпус 1 · Вещевой",
        text: "Одежда и обувь, спецодежда и военторг, хозтовары, турецкая бытовая химия, пряжа, карнизы для штор, ТВ и антенны.",
        tags: ["Одежда", "Обувь", "Военторг", "Хозтовары", "Турецкая химия", "Пряжа", "Шторы и карнизы"],
        photo: "assets/img/buildings/korpus-1.jpg",
        focus: [552, 745],
        action: true,
      },
      c2: {
        title: "Корпус 2 · Светофор",
        text: "Магазин-склад низких цен: продукты питания и бытовая химия.",
        tags: ["Продукты", "Бытовая химия"],
        photo: "assets/img/buildings/korpus-2.jpg",
        focus: [345, 715],
      },
      c3: {
        title: "Корпус 3 · Продуктовая галерея",
        text: "Овощи и фрукты, мясо, кондитерские изделия, хозтовары.",
        tags: ["Овощи и фрукты", "Мясо", "Кондитерская", "Хозтовары"],
        photo: "assets/img/buildings/korpus-3.jpg",
        focus: [122, 720],
      },
      adm: {
        title: "Администрация",
        text: "Администрация рынка, лаборатория, туалет и столовая «Щи-Борщи». Рядом парковка.",
        tags: ["Администрация", "Лаборатория", "Столовая", "Туалет"],
        photo: "assets/img/buildings/administraciya.jpg",
        focus: [525, 895],
      },
    };
    const IMG_W = 730;
    const IMG_H = 1144;

    const canvas = plan.querySelector(".plan__canvas");
    const card = plan.querySelector("[data-plan-card]");
    const body = card.querySelector(".plan-card__body");
    const photo = card.querySelector(".plan-card__photo");
    const title = card.querySelector(".title");
    const lead = card.querySelector(".plan-card__text .lead");
    const tagsEl = card.querySelector(".plan-tags");
    const action = card.querySelector(".plan-card__action");
    const closeBtn = card.querySelector(".plan-card__close");
    const polys = [...plan.querySelectorAll(".plan__svg polygon[data-id]")];
    const cutout = plan.querySelector(".plan__cut");
    const chips = [...plan.querySelectorAll(".plan__chip")];
    const listBtns = [...card.querySelectorAll(".plan-list button")];
    const sheetMq = matchMedia("(max-width: 899px)");
    let current = null;

    const polyFor = (id) => polys.find((p) => p.dataset.id === id);
    // url() внутри CSS-переменной считается от файла стилей, поэтому отдаём полный адрес
    const abs = (p) => new URL(p, document.baseURI).href;

    // Фото зданий грузим заранее, чтобы при нажатии они появлялись сразу
    const photoOk = {};
    Object.entries(BUILDINGS).forEach(([id, b]) => {
      const img = new Image();
      img.onload = () => { photoOk[id] = true; };
      img.onerror = () => {
        photoOk[id] = false;
        if (current === id) paintPhoto(id);
      };
      img.src = b.photo;
    });

    const paintPhoto = (id) => {
      const b = BUILDINGS[id];
      if (photoOk[id] !== false) {
        // Настоящее фото здания; пока грузится — ровный тёплый фон, без промежуточных кадров
        photo.style.setProperty("--photo", `url("${abs(b.photo)}")`);
        photo.style.setProperty("--bg-w", "cover");
        photo.style.setProperty("--bg-x", "center");
        photo.style.setProperty("--bg-y", "center");
        photo.setAttribute("aria-label", `Фото: ${b.title}`);
        return;
      }
      // Запасной вариант, если фото не загрузилось: фрагмент схемы с нужным зданием
      const w = photo.clientWidth || 360;
      const h = photo.clientHeight || 225;
      const k = w / 300; // показываем кусок схемы шириной ~300 px
      const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
      photo.style.setProperty("--bg-w", `${IMG_W * k}px`);
      photo.style.setProperty("--bg-x", `${clamp(-(b.focus[0] * k - w / 2), -(IMG_W * k - w), 0)}px`);
      photo.style.setProperty("--bg-y", `${clamp(-(b.focus[1] * k - h / 2), -(IMG_H * k - h), 0)}px`);
      photo.style.setProperty("--photo", `url("${abs("assets/img/plan.jpg")}")`);
      photo.setAttribute("aria-label", `Фрагмент схемы: ${b.title}`);
    };

    // ---- Шторка (телефон) ----
    const sy = new Spring(0, { damping: 1, response: 0.4 });
    let sheetOpen = false;
    const renderSheet = () => {
      card.style.transform = sy.value === 0 ? "" : `translateY(${sy.value}px)`;
    };
    const finishSheet = () => {
      // Сначала прячем (без анимации), потом возвращаем переходы: шторка не «вспыхивает» снова
      card.classList.add("is-dragging");
      card.classList.remove("is-open");
      card.style.transform = "";
      sy.value = 0;
      sy.velocity = 0;
      sy.target = 0;
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove("is-dragging")));
    };
    const sheetAnim = driver([sy], renderSheet, () => {
      if (sheetOpen) card.classList.remove("is-dragging");
      else finishSheet();
    });
    const openSheet = () => {
      sheetOpen = true;
      card.classList.add("is-open");
      card.style.transform = "";
      sy.value = 0;
      sy.velocity = 0;
    };
    const closeSheet = (velocity = 0) => {
      sheetOpen = false;
      if (reduceMotion.matches) {
        finishSheet();
        return;
      }
      card.classList.add("is-dragging");
      sy.configure({ damping: 1, response: 0.4 });
      sy.velocity = velocity;
      sy.target = card.offsetHeight + 40;
      sheetAnim.kick();
    };

    // ---- Выбор здания ----
    const select = (id, opts = {}) => {
      if (!BUILDINGS[id]) return;
      current = id;
      const b = BUILDINGS[id];
      plan.classList.add("has-active");
      card.classList.add("has-selection");
      polys.forEach((p) => p.classList.toggle("is-active", p.dataset.id === id));
      cutout.setAttribute("points", polyFor(id).getAttribute("points"));
      chips.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.id === id)));
      listBtns.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.id === id)));

      title.textContent = b.title;
      lead.textContent = b.text;
      tagsEl.replaceChildren(...b.tags.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
      action.hidden = !b.action;
      body.hidden = false;
      paintPhoto(id);

      if (sheetMq.matches) {
        sy.target = 0;
        openSheet();
        // Здание ставим в середину видимой области над шторкой
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const bb = polyFor(id).getBBox();
            const r = canvas.getBoundingClientRect();
            const cy = r.top + ((bb.y + bb.height / 2) / IMG_H) * r.height;
            const headerH = header ? header.offsetHeight : 64;
            const free = Math.max(160, window.innerHeight - card.offsetHeight - headerH);
            window.scrollBy({ top: cy - (headerH + free / 2), behavior: reduceMotion.matches ? "auto" : "smooth" });
          })
        );
      }
      if (!opts.silent) haptic(6);
    };

    const clear = () => {
      current = null;
      plan.classList.remove("has-active");
      card.classList.remove("has-selection");
      polys.forEach((p) => p.classList.remove("is-active"));
      chips.forEach((c) => c.setAttribute("aria-pressed", "false"));
      listBtns.forEach((c) => c.setAttribute("aria-pressed", "false"));
      body.hidden = true;
      if (sheetMq.matches) closeSheet();
    };

    chips.forEach((c) => c.addEventListener("click", () => (current === c.dataset.id && sheetMq.matches ? clear() : select(c.dataset.id))));
    listBtns.forEach((c) => c.addEventListener("click", () => select(c.dataset.id)));
    closeBtn.addEventListener("click", clear);
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && current && sheetMq.matches) clear();
    });

    // Нажатие по самому зданию (контуру) и подсветка при наведении
    const hit = (clientX, clientY) => {
      const r = canvas.getBoundingClientRect();
      const x = ((clientX - r.left) / r.width) * IMG_W;
      const y = ((clientY - r.top) / r.height) * IMG_H;
      const pt = new DOMPoint(x, y);
      return polys.find((p) => {
        // isPointInFill работает в координатах SVG
        try {
          return p.isPointInFill(pt);
        } catch (_) {
          return false;
        }
      });
    };
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const p = hit(e.clientX, e.clientY);
      polys.forEach((q) => q.classList.toggle("is-hover", q === p && !q.classList.contains("is-active")));
      canvas.style.cursor = p ? "pointer" : "";
    });
    canvas.addEventListener("pointerleave", () => polys.forEach((q) => q.classList.remove("is-hover")));
    canvas.addEventListener("click", (e) => {
      if (e.target.closest(".plan__chip")) return;
      const p = hit(e.clientX, e.clientY);
      if (p) select(p.dataset.id);
      else if (current && sheetMq.matches) clear();
    });

    // ---- Жест: тянем шторку вниз ----
    let drag = null;
    const dragTargets = [card.querySelector(".plan-card__handle"), card.querySelector(".plan-card__photo")];
    dragTargets.forEach((el) =>
      el.addEventListener("pointerdown", (e) => {
        if (!sheetMq.matches || !sheetOpen) return;
        el.setPointerCapture(e.pointerId);
        sheetAnim.stop();
        card.classList.add("is-dragging");
        drag = { id: e.pointerId, y0: e.clientY, base: sy.value, hist: [{ y: e.clientY, t: e.timeStamp }], el };
      })
    );
    const moveDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y0;
      // Вверх — с резиновым сопротивлением, вниз — 1:1
      sy.value = dy < 0 ? -rubberband(-dy, 240) : drag.base + dy;
      sy.velocity = 0;
      renderSheet();
      drag.hist.push({ y: e.clientY, t: e.timeStamp });
      if (drag.hist.length > 6) drag.hist.shift();
    };
    const endSheetDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      const a = d.hist[0];
      const b = d.hist[d.hist.length - 1];
      const v = ((b.y - a.y) / Math.max(1, b.t - a.t)) * 1000;
      const projected = sy.value + project(v);
      if (projected > card.offsetHeight * 0.4) {
        clear();
        closeSheet(v);
      } else {
        sy.configure({ damping: 0.85, response: 0.35 }); // лёгкий отскок: жест имел инерцию
        sy.velocity = v;
        sy.target = 0;
        sheetAnim.kick();
      }
    };
    dragTargets.forEach((el) => {
      el.addEventListener("pointermove", moveDrag);
      el.addEventListener("pointerup", endSheetDrag);
      el.addEventListener("pointercancel", endSheetDrag);
    });

    if (!sheetMq.matches) select("c1", { silent: true });

    // При смене размера экрана возвращаем в чистое состояние
    sheetMq.addEventListener("change", () => {
      card.classList.remove("is-open", "is-dragging");
      card.style.transform = "";
      sheetOpen = false;
      if (current) select(current, { silent: true });
    });
  }

  /* ------------------------------------------------------------------------
     Фото-тур: шаги «арка → корпус → дверь → ряд → магазин».
     Данные берутся из списка шагов в HTML (data-атрибуты), поэтому фото
     меняются без правки кода: достаточно подменить файлы и подписи.
     ------------------------------------------------------------------------ */
  document.querySelectorAll("[data-tour]").forEach((root) => {
    const list = root.querySelector("[data-tour-steps]");
    const stage = root.querySelector(".tour__stage");
    if (!list || !stage) return;
    const spot = stage.querySelector(".tour__spot");
    const spotLabel = spot.querySelector("b");
    const counter = stage.querySelector(".tour__count");
    const prev = root.querySelector("[data-tour-prev]");
    const next = root.querySelector("[data-tour-next]");
    const dotsEl = root.querySelector(".tour__dots");
    const items = [...list.children];
    const num = (v, d) => (v === undefined || v === "" ? d : parseFloat(v));
    const steps = items.map((li) => {
      const x = num(li.dataset.x, 50);
      const y = num(li.dataset.y, 50);
      return {
        img: li.dataset.img,
        alt: li.dataset.alt || "",
        x,
        y,
        z: num(li.dataset.zoom, 1),
        fx: num(li.dataset.fx, x),
        fy: num(li.dataset.fy, y),
        label: li.dataset.label || "",
      };
    });

    // Один слой на каждую уникальную картинку: соседние шаги с той же картинкой просто приближают её
    const layers = new Map();
    steps.forEach((s) => {
      if (layers.has(s.img)) return;
      const layer = document.createElement("div");
      layer.className = "tour__layer";
      const im = new Image();
      im.src = s.img;
      im.alt = s.alt;
      im.decoding = "async";
      im.draggable = false;
      layer.append(im);
      stage.prepend(layer);
      layers.set(s.img, layer);
    });

    const dots = steps.map((_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tour__dot";
      b.setAttribute("aria-label", "Шаг " + (i + 1));
      b.addEventListener("click", () => go(i));
      dotsEl.append(b);
      return b;
    });

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    let current = -1;
    let spotTimer = 0;

    function go(n) {
      n = clamp(n, 0, steps.length - 1);
      const s = steps[n];
      const layer = layers.get(s.img);
      const sameLayer = current >= 0 && steps[current].img === s.img;
      // Точку (fx, fy) переносим в центр кадра, но не показываем пустоту за краем картинки
      const tx = clamp(50 - s.fx * s.z, 100 - 100 * s.z, 0);
      const ty = clamp(50 - s.fy * s.z, 100 - 100 * s.z, 0);
      const transform = "translate(" + tx + "%, " + ty + "%) scale(" + s.z + ")";
      if (!sameLayer) {
        layer.style.transition = "none";
        layer.style.transform = transform;
        void layer.offsetWidth;
        layer.style.transition = "";
        layers.forEach((l) => l.classList.toggle("is-on", l === layer));
      } else {
        layer.style.transform = transform;
      }

      // Метка «куда идти» появляется после перехода
      clearTimeout(spotTimer);
      spot.classList.remove("is-on");
      spotTimer = setTimeout(
        () => {
          spot.style.left = s.x * s.z + tx + "%";
          spot.style.top = s.y * s.z + ty + "%";
          spotLabel.textContent = s.label;
          spotLabel.style.translate = "-50% 0";
          spot.classList.add("is-on");
          // Подпись не должна выходить за края кадра
          const sr = stage.getBoundingClientRect();
          const lr = spotLabel.getBoundingClientRect();
          let shift = 0;
          if (lr.right > sr.right - 8) shift = sr.right - 8 - lr.right;
          if (lr.left < sr.left + 8) shift = sr.left + 8 - lr.left;
          if (shift) spotLabel.style.translate = "calc(-50% + " + shift + "px) 0";
        },
        reduceMotion.matches ? 0 : sameLayer ? 380 : 480
      );

      counter.textContent = "Шаг " + (n + 1) + " из " + steps.length;
      items.forEach((li, i) => {
        li.classList.toggle("is-current", i === n);
        if (i === n) li.setAttribute("aria-current", "step");
        else li.removeAttribute("aria-current");
      });
      dots.forEach((d, i) => d.classList.toggle("is-on", i === n));
      prev.disabled = n === 0;
      const last = n === steps.length - 1;
      next.firstChild.textContent = last ? "Сначала " : "Дальше ";
      current = n;
    }

    prev.addEventListener("click", () => go(current - 1));
    next.addEventListener("click", () => go(current === steps.length - 1 ? 0 : current + 1));
    items.forEach((li, i) => {
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.addEventListener("click", () => go(i));
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go(i);
        }
      });
    });
    stage.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") go(current + 1);
      if (e.key === "ArrowLeft") go(current - 1);
    });

    // Свайп по кадру
    let sx = 0;
    let sy = 0;
    stage.addEventListener("pointerdown", (e) => {
      sx = e.clientX;
      sy = e.clientY;
    });
    stage.addEventListener("pointerup", (e) => {
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) go(current + (dx < 0 ? 1 : -1));
    });

    go(0);
    // На телефоне resize приходит при каждом сворачивании адресной строки — пересчитываем только при смене ширины
    let lastW = innerWidth;
    addEventListener("resize", () => {
      if (innerWidth === lastW) return;
      lastW = innerWidth;
      go(current);
    });
  });

})();
