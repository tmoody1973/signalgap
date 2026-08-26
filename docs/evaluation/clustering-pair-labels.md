# Clustering pair labels — please fill this in

**What this is.** 107 pairs of news sources drawn from one real Milwaukee scan
(294 sources, 2026-08-25). For each pair, the software has to decide whether the
two are covering **the same story**. This file is the answer key it gets graded
against. Nobody has labeled it yet — that is the job.

**What you are deciding.** For each pair, read the two headlines (and the snippet
under each, where one was captured) and write one word on the **Answer** line:

| write | when |
| --- | --- |
| `same` | both are covering the same underlying story or event |
| `different` | they are two separate stories |
| `unsure` | you genuinely cannot tell from what is shown |

`unsure` is a real answer, not a gap. A pair a careful editor cannot call is
signal — it tells us the software should not be confident either. It is excluded
from the scoring rather than counted against anything, so use it whenever it is
the honest answer. Leaving a line blank means "not labeled yet", which is
different from `unsure`.

**Edit only the Answer lines.** Everything else — the `P001` numbers and the
`<!-- pair: ... -->` comments — is how the test finds your answer. Write the
word after the colon, with or without backticks:

```
**Answer:** same
```

**Roughly how long.** Around 35 to 45 minutes. Most pairs are a five-second
call from the two headlines. Pairs are grouped so that related ones sit together
— one group is ten pairs over five copies of the same listing, and once you have
read those five titles the ten answers are the same answer.

**Judgement call worth making explicitly.** Some pairs are the same *thing* but
not a *story* — one high-school football game listed on five aggregator sites, or
two library branch pages sharing a newsletter footer. Label those `same` if they
are the same underlying thing; the fact that neither would make a lead is a
separate problem (source quality), and we would rather measure the two separately.
If you disagree with that, label them the way you think a merge should behave and
say so — the disagreement is the useful part.

**A few pairs are marked PRE-KNOWN**, with the answer we already believe from
reading the data. They are here so this sheet is not a rubber stamp and so the
score has something to measure recall against. Confirm them or overrule them; an
overrule is real information.

**What happens next.** `tests/unit/editorial/labeled-pairs.test.ts` reads this
file. While it is blank the test skips and `npm run check` stays green. Once
there are labels it asserts precision and recall floors against them, and goes
red if anyone drifts a clustering threshold.

---

### Group 1 — 22 pairs among the same handful of sources

#### P001

<!-- pair: k971etr9ek2m2dw61nc2x16d6s8d5snw|k97cp4yf7x290h4s1sjktg10sx8d51qx -->

**A.** At the Asian Street Food Festival : r/milwaukee
> It is a great thing to host the event like this. But this feels a complete tourist trap. Everything is overpriced. It is even doubling the price one can get ...

**B.** Ka Vang's Asian street food festival expands to Milwaukee ...
> Ka Vang's Asian street food festival debuts in Milwaukee this weekend with 50 vendors and cultural performances at Veterans Park.

**Answer:** 

---

#### P002

<!-- pair: k971vngy6aepjrzp7394f06g318d4scf|k9774gyt3arcn6m2gk0yc936bs8d4q3m -->

**A.** The Milwaukee County Zoo's annual "A la Carte" festival is ...
> The Milwaukee County Zoo's annual "A la Carte" festival is taking place from Aug. 20-23. The event features dozens of food vendors, music performances...

**B.** A La Carte at the Zoo
> This four-day summer staple features national headliners, local and regional entertainment across six stages, more than 30 popular Milwaukee restaurants, and of ...

**Answer:** 

---

#### P003

<!-- pair: k971vngy6aepjrzp7394f06g318d4scf|k9799magg6rzr2j91937pd1k6h8d59kx -->

**A.** The Milwaukee County Zoo's annual "A la Carte" festival is ...
> The Milwaukee County Zoo's annual "A la Carte" festival is taking place from Aug. 20-23. The event features dozens of food vendors, music performances...

**B.** The Weekend Trend with Sandy Maxx: Mexican Fiesta, Fresh Coast Jazz, Zoo A La Carte and More
> _(no snippet captured)_

**Answer:** 

---

#### P004

<!-- pair: k971vngy6aepjrzp7394f06g318d4scf|k97cp4yf7x290h4s1sjktg10sx8d51qx -->

**A.** The Milwaukee County Zoo's annual "A la Carte" festival is ...
> The Milwaukee County Zoo's annual "A la Carte" festival is taking place from Aug. 20-23. The event features dozens of food vendors, music performances...

**B.** Ka Vang's Asian street food festival expands to Milwaukee ...
> Ka Vang's Asian street food festival debuts in Milwaukee this weekend with 50 vendors and cultural performances at Veterans Park.

**Answer:** 

---

#### P005

<!-- pair: k9725nczpk2ae9pxtcknyfgpnn8d477v|k973ap802xbrsb06r4n2k41a2x8d4a8d -->

**A.** Areas to consider moving to? : r/milwaukee
> Hi all! My partner and I currently rent a 700 sq ft apartment on Brady Street, for about $1200/mo We are looking to move this coming spring to…

**B.** City Commission Approves Metcalfe Park Development ...
> The first phase would include renovating two apartments in the 3,400-square-foot building as affordable housing. It would also include a bookstore, a cafe, and ...

**Answer:** 

---

#### P006

<!-- pair: k972wcvf9tvy8hrbjkxmkxfh6s8d42a4|k973ap802xbrsb06r4n2k41a2x8d4a8d -->

**A.** Homes MKE - City of Milwaukee
> The goals of Homes MKE are to: sell, renovate and reoccupy up to 150 vacant foreclosed City owned houses. prioritize the development of the houses (414) 708- ...

**B.** City Commission Approves Metcalfe Park Development ...
> The first phase would include renovating two apartments in the 3,400-square-foot building as affordable housing. It would also include a bookstore, a cafe, and ...

**Answer:** 

---

#### P007

<!-- pair: k972wcvf9tvy8hrbjkxmkxfh6s8d42a4|k97a905v5nv0m7smvwjkvphnws8d47z8 -->

> PRE-KNOWN — expected **same** (`KNOWN MISS #2`). The same housing programme in Spanish and in English, one point under the floor.

**A.** Homes MKE - City of Milwaukee
> The goals of Homes MKE are to: sell, renovate and reoccupy up to 150 vacant foreclosed City owned houses. prioritize the development of the houses (414) 708- ...

**B.** Lo más importante del lado sur de Milwaukee ...
> Cada casa se venderá a aproximadamente $125,000, y solo se venderán a familias ganando por debajo del 80% del ingreso medio del área. Vecinos pueden aplicar ...

**Answer:** 

---

#### P008

<!-- pair: k972wcvf9tvy8hrbjkxmkxfh6s8d42a4|k97eyxc1qgmr61gzan2ds5ekn98d40wr -->

**A.** Homes MKE - City of Milwaukee
> The goals of Homes MKE are to: sell, renovate and reoccupy up to 150 vacant foreclosed City owned houses. prioritize the development of the houses (414) 708- ...

**B.** Mayor's "Back to School" Bike Ride
> Housing & Home Ownership. Join Mayor Cavalier Johnson and the City of Milwaukee for a fun, slow-roll ride through the East Side of Milwaukee! Riverside Park ...

**Answer:** 

---

#### P009

<!-- pair: k974ht5h84f1w8xve46ap8bxjs8d58k3|k976swhak0wceq2nkszmsch0ds8d50wx -->

**A.** Online registration now open for 2026 Back to School Festival
> _(no snippet captured)_

**B.** Online registration now open for 2026 Back to School Festival
> At the festival, attendees can enjoy a number of positive activities for children, including a bounce house, a bike raffle, a live DJ, free food and much more.

**Answer:** 

---

#### P010

<!-- pair: k975xbgmjvgzwe1t0xv6b5rzdd8d453c|k97eyxc1qgmr61gzan2ds5ekn98d40wr -->

> PRE-KNOWN — expected **different**. Shares only the neighbourhood `East Side`. The named must-NOT-merge trap.

**A.** Homeless family help : r/milwaukee
> On my route to work on the far east side, there is a seemingly homeless family with four very young children that has been occupying a bus stop for at least ...

**B.** Mayor's "Back to School" Bike Ride
> Housing & Home Ownership. Join Mayor Cavalier Johnson and the City of Milwaukee for a fun, slow-roll ride through the East Side of Milwaukee! Riverside Park ...

**Answer:** 

---

#### P011

<!-- pair: k9762qzz50hqcgt902syy7kvp18d4085|k977dnznnmwfmva4ajm4f184c98d42jh -->

**A.** Jazz in the Park
> Jazz in the Park is a free, outdoor, weekly summer music series, featuring an eclectic lineup of jazz, big band, funk, R & B, reggae, blues and more.

**B.** Washington Park Wednesdays at the Bandshell
> Washington Park Wednesdays is a weekly concert series at Washington Park and is an event of the Washington Park Neighbors.

**Answer:** 

---

#### P012

<!-- pair: k9762qzz50hqcgt902syy7kvp18d4085|k979jxscy5km0gxkv8wqa4g2bd8d5jxf -->

**A.** Jazz in the Park
> Jazz in the Park is a free, outdoor, weekly summer music series, featuring an eclectic lineup of jazz, big band, funk, R & B, reggae, blues and more.

**B.** Entertainment: Summer’s At Its Peak With Lots of Outdoor Festivals
> _(no snippet captured)_

**Answer:** 

---

#### P013

<!-- pair: k976swhak0wceq2nkszmsch0ds8d50wx|k97cnx1qgvcmzr4ndya0wz1x5s8d46m0 -->

**A.** Online registration now open for 2026 Back to School Festival
> At the festival, attendees can enjoy a number of positive activities for children, including a bounce house, a bike raffle, a live DJ, free food and much more.

**B.** 4th Annual Back to School Festival
> Enjoy a number of positive activities for children, including a bounce house, a bike raffle, a live DJ, free food and much more. Free hair haircuts are also ...

**Answer:** 

---

#### P014

<!-- pair: k976zy91w81sfem4267ygq3v2d8d5fwy|k97a5hpr2pq6ha6qxct25t1br58d42en -->

**A.** Milwaukee 3rd District Public Safety Town Hall Meeting on July 15
> _(no snippet captured)_

**B.** District 3 Community Bike Ride
> Details: Join us on Saturday, August 22, 2026, for a bike ride around the 3rd Aldermanic District — perfect for most ages and skill levels!

**Answer:** 

---

#### P015

<!-- pair: k9774gyt3arcn6m2gk0yc936bs8d4q3m|k9799magg6rzr2j91937pd1k6h8d59kx -->

**A.** A La Carte at the Zoo
> This four-day summer staple features national headliners, local and regional entertainment across six stages, more than 30 popular Milwaukee restaurants, and of ...

**B.** The Weekend Trend with Sandy Maxx: Mexican Fiesta, Fresh Coast Jazz, Zoo A La Carte and More
> _(no snippet captured)_

**Answer:** 

---

#### P016

<!-- pair: k9774gyt3arcn6m2gk0yc936bs8d4q3m|k979jxscy5km0gxkv8wqa4g2bd8d5jxf -->

**A.** A La Carte at the Zoo
> This four-day summer staple features national headliners, local and regional entertainment across six stages, more than 30 popular Milwaukee restaurants, and of ...

**B.** Entertainment: Summer’s At Its Peak With Lots of Outdoor Festivals
> _(no snippet captured)_

**Answer:** 

---

#### P017

<!-- pair: k9799magg6rzr2j91937pd1k6h8d59kx|k97djaa8s339a2jm2gs1p02a6d8d5czb -->

**A.** The Weekend Trend with Sandy Maxx: Mexican Fiesta, Fresh Coast Jazz, Zoo A La Carte and More
> _(no snippet captured)_

**B.** 2026 Fresh Coast Jazz Festival
> Get ready to groove at the 7th Annual Fresh Coast Jazz Festival! August 20–22, 2026 | Pabst Theater | Downtown Milwaukee. The Fresh Coast Jazz Festival is ...

**Answer:** 

---

#### P018

<!-- pair: k97a5hpr2pq6ha6qxct25t1br58d42en|k97eyxc1qgmr61gzan2ds5ekn98d40wr -->

**A.** District 3 Community Bike Ride
> Details: Join us on Saturday, August 22, 2026, for a bike ride around the 3rd Aldermanic District — perfect for most ages and skill levels!

**B.** Mayor's "Back to School" Bike Ride
> Housing & Home Ownership. Join Mayor Cavalier Johnson and the City of Milwaukee for a fun, slow-roll ride through the East Side of Milwaukee! Riverside Park ...

**Answer:** 

---

#### P019

<!-- pair: k97a905v5nv0m7smvwjkvphnws8d47z8|k97cp4yf7x290h4s1sjktg10sx8d51qx -->

**A.** Lo más importante del lado sur de Milwaukee ...
> Cada casa se venderá a aproximadamente $125,000, y solo se venderán a familias ganando por debajo del 80% del ingreso medio del área. Vecinos pueden aplicar ...

**B.** Ka Vang's Asian street food festival expands to Milwaukee ...
> Ka Vang's Asian street food festival debuts in Milwaukee this weekend with 50 vendors and cultural performances at Veterans Park.

**Answer:** 

---

#### P020

<!-- pair: k97a905v5nv0m7smvwjkvphnws8d47z8|k97ftm90rdqz4w77742a890hr18d5jdq -->

**A.** Lo más importante del lado sur de Milwaukee ...
> Cada casa se venderá a aproximadamente $125,000, y solo se venderán a familias ganando por debajo del 80% del ingreso medio del área. Vecinos pueden aplicar ...

**B.** Lo más importante del lado sur de Milwaukee ...
> Cada casa se venderá a aproximadamente $125,000, y solo se venderán a familias ganando por debajo del 80% del ingreso medio del área. Vecinos pueden aplicar ...

**Answer:** 

---

#### P021

<!-- pair: k97cnx1qgvcmzr4ndya0wz1x5s8d46m0|k97eyxc1qgmr61gzan2ds5ekn98d40wr -->

> PRE-KNOWN — expected **same** (`KNOWN MISS #1`). The ride happens AT that festival. They share no distinctive word, so the code never compares them — no wording change makes it find this.

**A.** 4th Annual Back to School Festival
> Enjoy a number of positive activities for children, including a bounce house, a bike raffle, a live DJ, free food and much more. Free hair haircuts are also ...

**B.** Mayor's "Back to School" Bike Ride
> Housing & Home Ownership. Join Mayor Cavalier Johnson and the City of Milwaukee for a fun, slow-roll ride through the East Side of Milwaukee! Riverside Park ...

**Answer:** 

---

#### P022

<!-- pair: k97cp4yf7x290h4s1sjktg10sx8d51qx|k97e3ffyry70mjy7vsmshnhmr58d5g9s -->

> PRE-KNOWN — expected **different**. Two unrelated festivals that share only the words `food` and `festival`. The code never even compares them.

**A.** Ka Vang's Asian street food festival expands to Milwaukee ...
> Ka Vang's Asian street food festival debuts in Milwaukee this weekend with 50 vendors and cultural performances at Veterans Park.

**B.** Freshwater Food & Wine Festival, Sept 19 - 20, Milwaukee
> Freshwater Food & Wine Festival celebrates world-class wines, craft beverages, and culinary artistry with stunning waterfront views.

**Answer:** 

---

### Group 2 — 19 pairs among the same handful of sources

#### P023

<!-- pair: k970ak555t8jzkbva0g9wzeefd8d42q8|k972nzey34r6dpxzsh7nh6wkx18d5rev -->

**A.** Uppa Yard Opens Water Street Location
> _(no snippet captured)_

**B.** Best Jamaican restaurant for a date? Uppa yard or Mobay ...
> Uppa yard got the better vibe for a date, more cozy and not so loud like Mobay.

**Answer:** 

---

#### P024

<!-- pair: k970cqyx2z9e1nhg6b44kv5q998d4jsy|k971624k42bsp3jg18zp81nsws8d5eqm -->

**A.** Getting an apartment in Bayview : r/milwaukee
> How hard is it to get a two-bedroom apartment in Bayview right now? If I were to start looking now, is there a realistic possibility that I could…

**B.** Enjoyed a trip to Milwaukee, but...
> Assuming he's BIPOC, he was probably sensitive to being profiled and got irrationally angry when you crossed the street because of him. I did this once and had

**Answer:** 

---

#### P025

<!-- pair: k970cqyx2z9e1nhg6b44kv5q998d4jsy|k973rc6bwvrw9se864q10bjcex8d5t93 -->

**A.** Getting an apartment in Bayview : r/milwaukee
> How hard is it to get a two-bedroom apartment in Bayview right now? If I were to start looking now, is there a realistic possibility that I could…

**B.** Are my restaurant choices ok? : r/milwaukee
> I'm coming to Milwaukee this weekend and I have a couple of meals to myself to account for. I have reservations going to Avli for dinner and the Knick.

**Answer:** 

---

#### P026

<!-- pair: k970cqyx2z9e1nhg6b44kv5q998d4jsy|k97dxmqfghqp413rd6hwfb5rbd8d4376 -->

**A.** Getting an apartment in Bayview : r/milwaukee
> How hard is it to get a two-bedroom apartment in Bayview right now? If I were to start looking now, is there a realistic possibility that I could…

**B.** Midtown apartment development getting $1 million city loan
> _(no snippet captured)_

**Answer:** 

---

#### P027

<!-- pair: k972nzey34r6dpxzsh7nh6wkx18d5rev|k9741p0rnbk3r4f8h0kgzt7scx8d41c8 -->

**A.** Best Jamaican restaurant for a date? Uppa yard or Mobay ...
> Uppa yard got the better vibe for a date, more cozy and not so loud like Mobay.

**B.** Dumpster Rental : r/milwaukee
> Hello all, I have recently demoed my kitchen and am in need of a dumpster rental to dispose of said demolition debris. Looking for a recommendations…

**Answer:** 

---

#### P028

<!-- pair: k973rc6bwvrw9se864q10bjcex8d5t93|k97bb63hm2z9jpbzzt3nf8mf218d5d57 -->

**A.** Are my restaurant choices ok? : r/milwaukee
> I'm coming to Milwaukee this weekend and I have a couple of meals to myself to account for. I have reservations going to Avli for dinner and the Knick.

**B.** Need dining recommendations for a Sunday night near ...
> Any recommendations for a nice dinner place with drinks? Favorite new(ish) bars/restaurants/cool stuff around town??

**Answer:** 

---

#### P029

<!-- pair: k9741p0rnbk3r4f8h0kgzt7scx8d41c8|k97bb63hm2z9jpbzzt3nf8mf218d5d57 -->

**A.** Dumpster Rental : r/milwaukee
> Hello all, I have recently demoed my kitchen and am in need of a dumpster rental to dispose of said demolition debris. Looking for a recommendations…

**B.** Need dining recommendations for a Sunday night near ...
> Any recommendations for a nice dinner place with drinks? Favorite new(ish) bars/restaurants/cool stuff around town??

**Answer:** 

---

#### P030

<!-- pair: k9741p0rnbk3r4f8h0kgzt7scx8d41c8|k97bn9kkkry0t3zymkp0xvjhw98d543s -->

**A.** Dumpster Rental : r/milwaukee
> Hello all, I have recently demoed my kitchen and am in need of a dumpster rental to dispose of said demolition debris. Looking for a recommendations…

**B.** Pizzerias with dining rooms? : r/milwaukee
> My husband is celebrating his 50th this weekend and he just wants a casual, sit-down pizza night with family. Any suggestions? Looking for a place that ...

**Answer:** 

---

#### P031

<!-- pair: k9741p0rnbk3r4f8h0kgzt7scx8d41c8|k97fnc4021emqcdt73nw3mwryx8d57am -->

**A.** Dumpster Rental : r/milwaukee
> Hello all, I have recently demoed my kitchen and am in need of a dumpster rental to dispose of said demolition debris. Looking for a recommendations…

**B.** Local fabric store suggestions : r/milwaukee
> I'm looking for a local store with a large fabric selection, please! My mom is still distraught over Joann's closing, and it's unimpressed with the Hobby ...

**Answer:** 

---

#### P032

<!-- pair: k978bjvwv1d36ece65fkmp956s8d503t|k97bb63hm2z9jpbzzt3nf8mf218d5d57 -->

**A.** What's happening on i94 by 35th street exit?? : r/milwaukee
> Does anyone know what's going on in the median around the Hogan Road exit? 1 upvote · 8 comments. Need help! r/marvelstudios. • 6d ago. Need help! 1 upvote ...

**B.** Need dining recommendations for a Sunday night near ...
> Any recommendations for a nice dinner place with drinks? Favorite new(ish) bars/restaurants/cool stuff around town??

**Answer:** 

---

#### P033

<!-- pair: k978bjvwv1d36ece65fkmp956s8d503t|k97fxb5cjzfjse8tcq9v9e2np98d500y -->

**A.** What's happening on i94 by 35th street exit?? : r/milwaukee
> Does anyone know what's going on in the median around the Hogan Road exit? 1 upvote · 8 comments. Need help! r/marvelstudios. • 6d ago. Need help! 1 upvote ...

**B.** Rescue mission : r/milwaukee
> Rescue mission. Does anyone know much about this place? Unfortunately I found myself homeless by Sunday and it seems to be the only option. Just curious if ...

**Answer:** 

---

#### P034

<!-- pair: k97bb63hm2z9jpbzzt3nf8mf218d5d57|k97bn9kkkry0t3zymkp0xvjhw98d543s -->

**A.** Need dining recommendations for a Sunday night near ...
> Any recommendations for a nice dinner place with drinks? Favorite new(ish) bars/restaurants/cool stuff around town??

**B.** Pizzerias with dining rooms? : r/milwaukee
> My husband is celebrating his 50th this weekend and he just wants a casual, sit-down pizza night with family. Any suggestions? Looking for a place that ...

**Answer:** 

---

#### P035

<!-- pair: k97bb63hm2z9jpbzzt3nf8mf218d5d57|k97f65327hzda59rs588mwekzh8d4cht -->

**A.** Need dining recommendations for a Sunday night near ...
> Any recommendations for a nice dinner place with drinks? Favorite new(ish) bars/restaurants/cool stuff around town??

**B.** Thinking of moving there : r/milwaukee
> So I'm M40 and my husband (M40) are thinking of moving to Milwaukee. What are the pros and cons of living there? It came up on our radar after a lengthy ...

**Answer:** 

---

#### P036

<!-- pair: k97bbcc8ryx1d3gmg9vn32et6d8d44bx|k97fnc4021emqcdt73nw3mwryx8d57am -->

**A.** Weekly Classifieds and Events : r/milwaukee
> Welcome to our weekly odds and ends post! If you are looking for events, please check out our exhaustive Events Calendar ! Every parent level comment…

**B.** Local fabric store suggestions : r/milwaukee
> I'm looking for a local store with a large fabric selection, please! My mom is still distraught over Joann's closing, and it's unimpressed with the Hobby ...

**Answer:** 

---

#### P037

<!-- pair: k97bn9kkkry0t3zymkp0xvjhw98d543s|k97fnc4021emqcdt73nw3mwryx8d57am -->

**A.** Pizzerias with dining rooms? : r/milwaukee
> My husband is celebrating his 50th this weekend and he just wants a casual, sit-down pizza night with family. Any suggestions? Looking for a place that ...

**B.** Local fabric store suggestions : r/milwaukee
> I'm looking for a local store with a large fabric selection, please! My mom is still distraught over Joann's closing, and it's unimpressed with the Hobby ...

**Answer:** 

---

#### P038

<!-- pair: k97cd08vxvgazcax0nxst0mzen8d4ahz|k97e2y72dk6yszjv00m2s72htd8d5nsc -->

**A.** River Woods Condos on Randolph Ct (Riverwest)
> Considering buying a unit at River Woods Condos on Randolph Ct. Anyone live there or have experience with the building management?

**B.** what is the turner ballroomroom like? : r/milwaukee
> I've been to a few shows in mikwaukee and elsewhere but I've never been to this venue, I'll be seeing shakey graves in October and was just wondering if ...

**Answer:** 

---

#### P039

<!-- pair: k97cd08vxvgazcax0nxst0mzen8d4ahz|k97esrh5af0ezn3hst0pv6e5ch8d5gqq -->

**A.** River Woods Condos on Randolph Ct (Riverwest)
> Considering buying a unit at River Woods Condos on Randolph Ct. Anyone live there or have experience with the building management?

**B.** Una escapada a Riverwest - Departamentos en renta ...
> Alojamiento entero: vivienda rentada en Milwaukee, Wisconsin, Estados Unidos. 4 huéspedes ·; · 2 habitaciones ·; · 2 camas ·; · 1 baño. Anuncio nuevo. Nuevo.

**Answer:** 

---

#### P040

<!-- pair: k97cd08vxvgazcax0nxst0mzen8d4ahz|k97f65327hzda59rs588mwekzh8d4cht -->

**A.** River Woods Condos on Randolph Ct (Riverwest)
> Considering buying a unit at River Woods Condos on Randolph Ct. Anyone live there or have experience with the building management?

**B.** Thinking of moving there : r/milwaukee
> So I'm M40 and my husband (M40) are thinking of moving to Milwaukee. What are the pros and cons of living there? It came up on our radar after a lengthy ...

**Answer:** 

---

#### P041

<!-- pair: k97e2y72dk6yszjv00m2s72htd8d5nsc|k97eagp469vv815kedf45g1k9d8d4ppa -->

**A.** what is the turner ballroomroom like? : r/milwaukee
> I've been to a few shows in mikwaukee and elsewhere but I've never been to this venue, I'll be seeing shakey graves in October and was just wondering if ...

**B.** Zilli Hospitality Wedding : r/milwaukee
> Hi all, wondering if anyone has used a Zilli venue for their wedding within the last year and would be comfortable sharing their per person…

**Answer:** 

---

### Group 3 — 10 pairs among the same handful of sources

#### P042

<!-- pair: k973xyw5rbph5bd1p54nprhrtn8d56v8|k9798gx9kbgcahk3pjv0rnn2xn8d5kdy -->

**A.** Fire damages nearly completed West Allis Public Works facility under construction
> _(no snippet captured)_

**B.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**Answer:** 

---

#### P043

<!-- pair: k973xyw5rbph5bd1p54nprhrtn8d56v8|k979h3e30pwvk3bk49s4zm59x18d5be2 -->

**A.** Fire damages nearly completed West Allis Public Works facility under construction
> _(no snippet captured)_

**B.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**Answer:** 

---

#### P044

<!-- pair: k973xyw5rbph5bd1p54nprhrtn8d56v8|k97bjp8abqaagkyaf3s42exrwx8d57br -->

**A.** Fire damages nearly completed West Allis Public Works facility under construction
> _(no snippet captured)_

**B.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**Answer:** 

---

#### P045

<!-- pair: k973xyw5rbph5bd1p54nprhrtn8d56v8|k97dj67yj7vf5q91ghqz23t08d8d5sj9 -->

**A.** Fire damages nearly completed West Allis Public Works facility under construction
> _(no snippet captured)_

**B.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**Answer:** 

---

#### P046

<!-- pair: k9798gx9kbgcahk3pjv0rnn2xn8d5kdy|k979h3e30pwvk3bk49s4zm59x18d5be2 -->

**A.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**B.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**Answer:** 

---

#### P047

<!-- pair: k9798gx9kbgcahk3pjv0rnn2xn8d5kdy|k97bjp8abqaagkyaf3s42exrwx8d57br -->

**A.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**B.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**Answer:** 

---

#### P048

<!-- pair: k9798gx9kbgcahk3pjv0rnn2xn8d5kdy|k97dj67yj7vf5q91ghqz23t08d8d5sj9 -->

**A.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**B.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**Answer:** 

---

#### P049

<!-- pair: k979h3e30pwvk3bk49s4zm59x18d5be2|k97bjp8abqaagkyaf3s42exrwx8d57br -->

**A.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**B.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**Answer:** 

---

#### P050

<!-- pair: k979h3e30pwvk3bk49s4zm59x18d5be2|k97dj67yj7vf5q91ghqz23t08d8d5sj9 -->

**A.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**B.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**Answer:** 

---

#### P051

<!-- pair: k97bjp8abqaagkyaf3s42exrwx8d57br|k97dj67yj7vf5q91ghqz23t08d8d5sj9 -->

**A.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**B.** West Allis-West Milwaukee DPW fire, building under construction
> _(no snippet captured)_

**Answer:** 

---

### Group 4 — 10 pairs among the same handful of sources

#### P052

<!-- pair: k974b5wkybd1j0vgydr8hx4hzs8d4fs4|k97501py9sf1r3hp6tr9grnspd8d55qd -->

**A.** Catholic Memorial vs Bradley Tech/Milwaukee Arts Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**B.** Bradley Tech/Milwaukee Arts vs Catholic Memorial Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**Answer:** 

---

#### P053

<!-- pair: k974b5wkybd1j0vgydr8hx4hzs8d4fs4|k97574vpc4b7aprssm2vhkzsj98d5an0 -->

**A.** Catholic Memorial vs Bradley Tech/Milwaukee Arts Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**B.** Bradley Tech/Milwaukee Arts vs Catholic Memorial Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**Answer:** 

---

#### P054

<!-- pair: k974b5wkybd1j0vgydr8hx4hzs8d4fs4|k978h3m8d2vnv249ekjdyh63sh8d4fwc -->

**A.** Catholic Memorial vs Bradley Tech/Milwaukee Arts Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**B.** Catholic Memorial vs Bradley Tech/Milwaukee Arts Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**Answer:** 

---

#### P055

<!-- pair: k974b5wkybd1j0vgydr8hx4hzs8d4fs4|k97bpm1crcnwnq2rjzjp7aa8198d41tx -->

**A.** Catholic Memorial vs Bradley Tech/Milwaukee Arts Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**B.** Bradley Tech/Milwaukee Arts vs Catholic Memorial Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**Answer:** 

---

#### P056

<!-- pair: k97501py9sf1r3hp6tr9grnspd8d55qd|k97574vpc4b7aprssm2vhkzsj98d5an0 -->

**A.** Bradley Tech/Milwaukee Arts vs Catholic Memorial Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**B.** Bradley Tech/Milwaukee Arts vs Catholic Memorial Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**Answer:** 

---

#### P057

<!-- pair: k97501py9sf1r3hp6tr9grnspd8d55qd|k978h3m8d2vnv249ekjdyh63sh8d4fwc -->

**A.** Bradley Tech/Milwaukee Arts vs Catholic Memorial Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**B.** Catholic Memorial vs Bradley Tech/Milwaukee Arts Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**Answer:** 

---

#### P058

<!-- pair: k97501py9sf1r3hp6tr9grnspd8d55qd|k97bpm1crcnwnq2rjzjp7aa8198d41tx -->

**A.** Bradley Tech/Milwaukee Arts vs Catholic Memorial Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**B.** Bradley Tech/Milwaukee Arts vs Catholic Memorial Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**Answer:** 

---

#### P059

<!-- pair: k97574vpc4b7aprssm2vhkzsj98d5an0|k978h3m8d2vnv249ekjdyh63sh8d4fwc -->

**A.** Bradley Tech/Milwaukee Arts vs Catholic Memorial Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**B.** Catholic Memorial vs Bradley Tech/Milwaukee Arts Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**Answer:** 

---

#### P060

<!-- pair: k97574vpc4b7aprssm2vhkzsj98d5an0|k97bpm1crcnwnq2rjzjp7aa8198d41tx -->

**A.** Bradley Tech/Milwaukee Arts vs Catholic Memorial Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**B.** Bradley Tech/Milwaukee Arts vs Catholic Memorial Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**Answer:** 

---

#### P061

<!-- pair: k978h3m8d2vnv249ekjdyh63sh8d4fwc|k97bpm1crcnwnq2rjzjp7aa8198d41tx -->

**A.** Catholic Memorial vs Bradley Tech/Milwaukee Arts Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**B.** Bradley Tech/Milwaukee Arts vs Catholic Memorial Live Free Wisconsin High School Football 2026
> _(no snippet captured)_

**Answer:** 

---

### Group 5 — 7 pairs among the same handful of sources

#### P062

<!-- pair: k9701ydgns5a26fqrzmtq4rymd8d42v6|k977rh8rcxdfmnrap4jpfzxbwx8d5keh -->

**A.** Lindsay Heights NID #12 Safety Committee
> Lindsay Heights NID #12 Safety Committee. Wednesday, August 26, 2026. 5:30 PM to 7:00 PM. BLK Coffee, 2125 W. Fond Du Lac Ave. Add event to your calendar.

**B.** City of Milwaukee - Calendar
> ZONING, NEIGHBORHOODS & DEVELOPMENT COMMITTEE. NEIGHBORHOOD IMPROVEMENT DEVELOPMENT CORPORATION ・ 526 E Concordia Ave ・ 1:00 PM Room 301-A, Third Floor, City ...

**Answer:** 

---

#### P063

<!-- pair: k9701ydgns5a26fqrzmtq4rymd8d42v6|k97fvrfnqmqjtm8xgcfkv7srxx8d42fb -->

**A.** Lindsay Heights NID #12 Safety Committee
> Lindsay Heights NID #12 Safety Committee. Wednesday, August 26, 2026. 5:30 PM to 7:00 PM. BLK Coffee, 2125 W. Fond Du Lac Ave. Add event to your calendar.

**B.** Licenses Committee - City of Milwaukee
> Licenses Committee- Special- MEETING CANCELLED on 8/24/2026. Friday, September 4, 2026. 9:00 AM. City Hall, 200 E. Wells St. Milwaukee, WI, 53202, ...

**Answer:** 

---

#### P064

<!-- pair: k9704k47pc18w25rpghqnq4eqx8d4q5d|k9757npa1nvrb9yrsttyher1gn8d4cas -->

**A.** Housing Authority
> City Development Community Development Grants. Zoning Appeals … 200 E. Wells St. Milwaukee, WI, 53202, Room 301-B. Contact: Talisa Larson Email: Talisa.Larson@ ...

**B.** Joint Review Board - City Event - Milwaukee.gov
> City Development Community Development Grants. Zoning Appeals. Housing & Home Ownership. City Development, 809 N. Broadway, Milwaukee, WI, dmisky@milwaukee.gov ...

**Answer:** 

---

#### P065

<!-- pair: k9704k47pc18w25rpghqnq4eqx8d4q5d|k977rh8rcxdfmnrap4jpfzxbwx8d5keh -->

**A.** Housing Authority
> City Development Community Development Grants. Zoning Appeals … 200 E. Wells St. Milwaukee, WI, 53202, Room 301-B. Contact: Talisa Larson Email: Talisa.Larson@ ...

**B.** City of Milwaukee - Calendar
> ZONING, NEIGHBORHOODS & DEVELOPMENT COMMITTEE. NEIGHBORHOOD IMPROVEMENT DEVELOPMENT CORPORATION ・ 526 E Concordia Ave ・ 1:00 PM Room 301-A, Third Floor, City ...

**Answer:** 

---

#### P066

<!-- pair: k9704k47pc18w25rpghqnq4eqx8d4q5d|k979p21q664n2xndd36c5bvpt58d5zp9 -->

**A.** Housing Authority
> City Development Community Development Grants. Zoning Appeals … 200 E. Wells St. Milwaukee, WI, 53202, Room 301-B. Contact: Talisa Larson Email: Talisa.Larson@ ...

**B.** City of Milwaukee Meeting & Events Calendar
> City Development Community Development Grants. Zoning Appeals. Housing & Home Ownership Homeownership Opportunities Housing Resources. Neighborhood Service ...

**Answer:** 

---

#### P067

<!-- pair: k9704k47pc18w25rpghqnq4eqx8d4q5d|k97fvrfnqmqjtm8xgcfkv7srxx8d42fb -->

**A.** Housing Authority
> City Development Community Development Grants. Zoning Appeals … 200 E. Wells St. Milwaukee, WI, 53202, Room 301-B. Contact: Talisa Larson Email: Talisa.Larson@ ...

**B.** Licenses Committee - City of Milwaukee
> Licenses Committee- Special- MEETING CANCELLED on 8/24/2026. Friday, September 4, 2026. 9:00 AM. City Hall, 200 E. Wells St. Milwaukee, WI, 53202, ...

**Answer:** 

---

#### P068

<!-- pair: k9757npa1nvrb9yrsttyher1gn8d4cas|k979p21q664n2xndd36c5bvpt58d5zp9 -->

**A.** Joint Review Board - City Event - Milwaukee.gov
> City Development Community Development Grants. Zoning Appeals. Housing & Home Ownership. City Development, 809 N. Broadway, Milwaukee, WI, dmisky@milwaukee.gov ...

**B.** City of Milwaukee Meeting & Events Calendar
> City Development Community Development Grants. Zoning Appeals. Housing & Home Ownership Homeownership Opportunities Housing Resources. Neighborhood Service ...

**Answer:** 

---

### Group 6 — 3 pairs among the same handful of sources

#### P069

<!-- pair: k970eyy56kn0eyz4gj3qag7ep18d4csh|k9716sxmbvv1088msngnyd07f98d44tr -->

**A.** Koss opens new store and museum attached to Milwaukee headquarters
> _(no snippet captured)_

**B.** Koss Reopens Milwaukee Factory Store as a Museum for Its Headphone Legacy
> _(no snippet captured)_

**Answer:** 

---

#### P070

<!-- pair: k970eyy56kn0eyz4gj3qag7ep18d4csh|k97ba2j4pv5h0vj02d4jyjbtpn8d4ksn -->

**A.** Koss opens new store and museum attached to Milwaukee headquarters
> _(no snippet captured)_

**B.** Koss opens new store and museum attached to Milwaukee headquarters
> _(no snippet captured)_

**Answer:** 

---

#### P071

<!-- pair: k9716sxmbvv1088msngnyd07f98d44tr|k97ba2j4pv5h0vj02d4jyjbtpn8d4ksn -->

**A.** Koss Reopens Milwaukee Factory Store as a Museum for Its Headphone Legacy
> _(no snippet captured)_

**B.** Koss opens new store and museum attached to Milwaukee headquarters
> _(no snippet captured)_

**Answer:** 

---

### Group 7 — 3 pairs among the same handful of sources

#### P072

<!-- pair: k970xy12xevah5bg0k6zxwk4f98d47wg|k976esahhd3x12xpmpzmecx1xx8d4y5z -->

**A.** What belongs on the front page of the Journal Sentinel? Here's what kids drew
> _(no snippet captured)_

**B.** Milwaukee Journal Sentinel
> Agentes de ICE llegaron al lugar, rodearon la vivienda y procedieron a detener a los trabajadores. Testigos y el hecho documentado en video por uno de los ...

**Answer:** 

---

#### P073

<!-- pair: k970xy12xevah5bg0k6zxwk4f98d47wg|k97awza15dcgc17sy9dx4m0e6n8d5brv -->

**A.** What belongs on the front page of the Journal Sentinel? Here's what kids drew
> _(no snippet captured)_

**B.** What belongs on the front page? See what Metcalfe Park youth think
> _(no snippet captured)_

**Answer:** 

---

#### P074

<!-- pair: k97awza15dcgc17sy9dx4m0e6n8d5brv|k97dnj5seaa2j3ah5fdr0ex61d8d4s7q -->

**A.** What belongs on the front page? See what Metcalfe Park youth think
> _(no snippet captured)_

**B.** Harambee residents and youth draw the front page they want to see
> _(no snippet captured)_

**Answer:** 

---

### Group 8 — 3 pairs among the same handful of sources

#### P075

<!-- pair: k973t11d69tqsdw9qa0cfbes2h8d4xj2|k97c9v3cpj9eekwnmdgg3fe4rs8d50w4 -->

**A.** Milwaukee NNS examines what's changed since the 2016 Sherman Park Uprising
> _(no snippet captured)_

**B.** Investments Changed Sherman Park Neighborhood After 2016 Uprising
> _(no snippet captured)_

**Answer:** 

---

#### P076

<!-- pair: k973t11d69tqsdw9qa0cfbes2h8d4xj2|k97f05bj758m1z56mahtd6y2q98d5vxg -->

**A.** Milwaukee NNS examines what's changed since the 2016 Sherman Park Uprising
> _(no snippet captured)_

**B.** Investments changed Milwaukee’s Sherman Park after 2016 uprising, but who benefited remains unclear
> _(no snippet captured)_

**Answer:** 

---

#### P077

<!-- pair: k97c9v3cpj9eekwnmdgg3fe4rs8d50w4|k97f05bj758m1z56mahtd6y2q98d5vxg -->

**A.** Investments Changed Sherman Park Neighborhood After 2016 Uprising
> _(no snippet captured)_

**B.** Investments changed Milwaukee’s Sherman Park after 2016 uprising, but who benefited remains unclear
> _(no snippet captured)_

**Answer:** 

---

### Group 9 — 2 pairs among the same handful of sources

#### P078

<!-- pair: k970xb25mk8zjt4fy8w5a9h9gd8d5frs|k978h3m2mhh59v3nx0c24c7vx98d554d -->

**A.** Art & Hops, with the Traveling Beer Garden
> Date:May 14th - August 20th Time:5:00 PM - 9:00 PM Location:May 14: Wilson Park, 1601 W Howard Ave, Milwaukee, WI 53221. At this free event, you'll stroll ...

**B.** Howard Fuller Collegiate Academy via RT 12
> Due to construction, Route 12 & HF1 will detour off Teutonia Avenue from Keefe Avenue to 20th Street. The following NORTHBOUND TRIP bus stops will be INACTIVE ...

**Answer:** 

---

#### P079

<!-- pair: k978h3m2mhh59v3nx0c24c7vx98d554d|k97frwn27mmjx3m42jjt9bd9yd8d4sp6 -->

**A.** Howard Fuller Collegiate Academy via RT 12
> Due to construction, Route 12 & HF1 will detour off Teutonia Avenue from Keefe Avenue to 20th Street. The following NORTHBOUND TRIP bus stops will be INACTIVE ...

**B.** Howard Fuller Collegiate Academy via BLU & 30
> Find detailed information on schedules & routes of the HF2 bus, Howard Fuller Collegiate Academy via BLU & 30, on Milwaukee County Transit System.

**Answer:** 

---

### Group 10 — 2 pairs among the same handful of sources

#### P080

<!-- pair: k973bjpsvtrwj3k8jr3ffma8858d57bx|k97672wk5zze14frwc323090n58d4x98 -->

**A.** Gov. Evers: Joins Milwaukee County Executive Crowley and local leaders to celebrate the official reopening of the Clinton & Bernice Rose Senior Center
> _(no snippet captured)_

**B.** Governor Evers and County Executive Crowley Officially ...
> In 2024, Governor Tony Evers and the Wisconsin Department of Administration (DOA) awarded Milwaukee County a Flexible Facilities Program Grant for $3,967,737 in ...

**Answer:** 

---

#### P081

<!-- pair: k973bjpsvtrwj3k8jr3ffma8858d57bx|k97e08jhqn8n07qv8mr3ybtc758d4f3c -->

**A.** Gov. Evers: Joins Milwaukee County Executive Crowley and local leaders to celebrate the official reopening of the Clinton & Bernice Rose Senior Center
> _(no snippet captured)_

**B.** Gov. Evers Appoints Malinda Eskra to the Milwaukee County Circuit Court
> _(no snippet captured)_

**Answer:** 

---

### Group 11 — 2 pairs among the same handful of sources

#### P082

<!-- pair: k9743nc6f9783e7761pe1pmvcx8d5smy|k97et2gcc6r2hk5gkr4syn45wn8d5hpz -->

**A.** Feds to probe whether Milwaukee Public Schools considers race in student discipline
> _(no snippet captured)_

**B.** US Education Department investigates Milwaukee Public Schools over race-conscious discipline practices
> _(no snippet captured)_

**Answer:** 

---

#### P083

<!-- pair: k9743nc6f9783e7761pe1pmvcx8d5smy|k97ey7vv4j5damwzeys6dc6z398d4g3b -->

**A.** Feds to probe whether Milwaukee Public Schools considers race in student discipline
> _(no snippet captured)_

**B.** Leaders react to federal investigation into whether MPS considers race when disciplining students
> _(no snippet captured)_

**Answer:** 

---

### Group 12 — 2 pairs among the same handful of sources

#### P084

<!-- pair: k9768tty0qd97w1w077ec83nc98d508b|k97b63h48qqrr27xqtnesj7bt98d53c4 -->

**A.** Mitchell Street
> Inspiration starts here. 814 W. Wisconsin Avenue, Milwaukee, WI 53233. (414) 286-3000 · Find your branch. Newsletter Signup. Sign up for our newsletter.

**B.** Library Now
> Inspiration starts here. 814 W. Wisconsin Avenue, Milwaukee, WI 53233. (414) 286-3000 · Find your branch. Newsletter Signup. Sign up for our newsletter.

**Answer:** 

---

#### P085

<!-- pair: k97b63h48qqrr27xqtnesj7bt98d53c4|k97dz6bt9kz2xnd5keah8h290h8d5gyb -->

**A.** Library Now
> Inspiration starts here. 814 W. Wisconsin Avenue, Milwaukee, WI 53233. (414) 286-3000 · Find your branch. Newsletter Signup. Sign up for our newsletter.

**B.** Harambee NID #7
> Harambee NID #7. Tuesday, August 25, 2026. 5:30 PM to 7:30 PM. Milwaukee Public Library, Dr. Martin Luther King Jr. Branch, 2901 N. MLK Dr. Milwaukee, WI, ...

**Answer:** 

---

### Group 13 — 2 pairs among the same handful of sources

#### P086

<!-- pair: k97cw1sfmcnc232bb1mwc9xpms8d5ze4|k97dedbvv41cz23p99kxwy76358d4fy1 -->

**A.** 2762 N 51st St, Milwaukee, WI 53210 - Casas
> Ubicado en un conveniente vecindario de Milwaukee con fácil acceso a parques, tiendas, restaurantes, escuelas y las principales vías, disfrutará de comodidad y ...

**B.** Alex Klaus / Servicio de Noticias del Vecindario de ...
> Según funcionarios gubernamentales, la política del distrito viola la ley federal. Los estudiantes negros de las Escuelas Públicas de Milwaukee (MPS) siguen ...

**Answer:** 

---

#### P087

<!-- pair: k97dbpcpmw5mwbet3kn8zz9xjs8d5env|k97dedbvv41cz23p99kxwy76358d4fy1 -->

**A.** Archivo de Artes y Recreación | Servicio de Noticias del ...
> Un nuevo jardín en el código postal 53206, cuidado por jóvenes de Milwaukee, se convierte en un refugio seguro para la autorreflexión. foto de avatar by Chesnie ...

**B.** Alex Klaus / Servicio de Noticias del Vecindario de ...
> Según funcionarios gubernamentales, la política del distrito viola la ley federal. Los estudiantes negros de las Escuelas Públicas de Milwaukee (MPS) siguen ...

**Answer:** 

---

#### P088

<!-- pair: k9702dt5t6tg5nyj9arzcq13qs8d5sqq|k975y1kcf5ef8qn2snktdfk6k18d4eh8 -->

**A.** Big Blue Building Joins Downtown Office-To-Housing Boom
> _(no snippet captured)_

**B.** Big Blue Building Joins Downtown Office-To-Housing Boom
> _(no snippet captured)_

**Answer:** 

---

#### P089

<!-- pair: k970ak911q89bxmyfxd930vmxh8d5m06|k97c2kb0vbe3eybzt38bw8ca818d59k8 -->

**A.** Severe storms knock trees on to cars in Milwaukee
> _(no snippet captured)_

**B.** ‘It’s insane’: Storms tear through Milwaukee, crushing cars and damaging homes
> _(no snippet captured)_

**Answer:** 

---

#### P090

<!-- pair: k9718q3rs46m660kw88488j7w58d5dkp|k977st9xcy03jgnd20m9jywrwn8d511c -->

**A.** Milwaukee mother killed in road rage shooting identified; 18-year-old woman arrested
> _(no snippet captured)_

**B.** Milwaukee fatal road rage shooting, woman killed identified
> _(no snippet captured)_

**Answer:** 

---

#### P091

<!-- pair: k971qjbpt9n9zcv5k3fwjxyg858d47t6|k97cstafqd0bg4cc7kj1n7knm98d4kdj -->

**A.** Walter Street at Milwaukee Street to close August 24–26 for Utility Work
> _(no snippet captured)_

**B.** Walter at Milwaukee Street closing August 24-26 for utility installation
> _(no snippet captured)_

**Answer:** 

---

#### P092

<!-- pair: k971t58q9bzkt8a51maet2wyw58d5nx1|k97ftmnkqm7man9rp28w22jkvh8d5sbs -->

**A.** Pope Leo Village brings affordable housing to Milwaukee's Harambee neighborhood
> _(no snippet captured)_

**B.** Pope Leo Village brings affordable housing to Milwaukee's Harambee neighborhood
> _(no snippet captured)_

**Answer:** 

---

#### P093

<!-- pair: k972enstjvbc317nzt9k7x13cd8d59kz|k977cdfnhnhdh9bj9k5z8336td8d5p64 -->

**A.** Suspect driver arrested in Denver hit and run that left bicyclist seriously injured
> _(no snippet captured)_

**B.** Dodge County motorcycle crash; hit guardrail, driver seriously injured
> _(no snippet captured)_

**Answer:** 

---

#### P094

<!-- pair: k972x9mxsdmnme4zd5mjqkvfph8d5kwg|k973m6bs9hg1dxd817jsr2enz98d55wk -->

**A.** Milwaukee County Transit System, highways get $13.9M federal boost
> _(no snippet captured)_

**B.** Milwaukee County Transit System, highways get $13.9M federal boost
> _(no snippet captured)_

**Answer:** 

---

#### P095

<!-- pair: k972zdpf97pdqrtmr5d511ctj18d47vf|k97c83scydftafweyktk000wqd8d5fb7 -->

**A.** Free admission days at Milwaukee museums in September 2026
> _(no snippet captured)_

**B.** Free admission days at Milwaukee museums in September 2026
> _(no snippet captured)_

**Answer:** 

---

#### P096

<!-- pair: k9732d1n2kemdyjp3x96mq8r3n8d566w|k976qsx713mgnq44xsva3x0p5h8d56ex -->

**A.** New Milwaukee memorial honors civil rights leader Vel R. Phillips
> _(no snippet captured)_

**B.** New Milwaukee memorial honors civil rights leader Vel R. Phillips
> _(no snippet captured)_

**Answer:** 

---

#### P097

<!-- pair: k9749ynh2zebjbwtzty253axxs8d48mn|k979tmmwt1f7kzkcbydj8qsn9s8d59h3 -->

**A.** VIA CDC hopes new housing model will make homeownership more affordable
> _(no snippet captured)_

**B.** VIA CDC hopes new housing model will make homeownership more affordable
> _(no snippet captured)_

**Answer:** 

---

#### P098

<!-- pair: k974k5stegmcp8frzaqrnj99a98d46z4|k978nhd4efybvsnyy5b5vry5418d4eft -->

**A.** Transportation: MCTS Graduates First Class of Journeyman Bus Drivers
> _(no snippet captured)_

**B.** Transportation: Federal Grant Will Help Modernize MCTS Buses
> _(no snippet captured)_

**Answer:** 

---

#### P099

<!-- pair: k975y74vc3xqp744r2bd7p3n758d4hfe|k97dhb5bdy8zz72362zpqy4jk18d54tw -->

**A.** Milwaukee County Executive David Crowley Announces ...
> Milwaukee County Executive David Crowley Announces $13.9m Grant to Modernize Bus Fleet, Grow Ridership and Improve Travel Times on Major County Trunk Highways.

**B.** Milwaukee County Executive David Crowley Announces $13.9m Grant to Modernize Bus Fleet, Grow Ridership and Improve Travel Times on Major County Trunk Highways
> _(no snippet captured)_

**Answer:** 

---

#### P100

<!-- pair: k9760a49tp10phwh1mavcqeqyx8d4p6w|k97a1591avveb6431gexn0r5cn8d572y -->

**A.** Milwaukee’s The Garage responds to online backlash over ‘NO PLAY LIST’
> _(no snippet captured)_

**B.** Milwaukee bar responds after 'No Milwaukee Rap' list goes viral
> _(no snippet captured)_

**Answer:** 

---

#### P101

<!-- pair: k976wpr3k50xbatm8whc0b8g118d5wjc|k97esczebggs8ztf18ft4btamx8d4r83 -->

**A.** AFTERLIGHT brings free arts event to Milwaukee Riverwalk
> _(no snippet captured)_

**B.** AFTERLIGHT brings free arts event to Milwaukee Riverwalk
> _(no snippet captured)_

**Answer:** 

---

#### P102

<!-- pair: k977m0f4jg7f0ezr23j0vebtw98d4h2j|k97ezvj2pyepwd6pjg3rvkycds8d49m5 -->

**A.** Milwaukee business owner hit by third break-in in two months
> _(no snippet captured)_

**B.** Milwaukee's 38th Street Mart Hit by Third Break-In in 2 Months
> _(no snippet captured)_

**Answer:** 

---

#### P103

<!-- pair: k977pdqkeqhx7e78rk5c98cwax8d4qve|k978yjjeb581s2xm5xnvh68fd18d55tz -->

**A.** Mexican Fiesta returns to Milwaukee for 53rd annual celebration
> _(no snippet captured)_

**B.** Mexican Fiesta Returns to Milwaukee's Lakefront, Funding Nearly $2M in Scholarships
> _(no snippet captured)_

**Answer:** 

---

#### P104

<!-- pair: k979srymyrt3jsbm4p0r5jvthn8d54y1|k97fys6phmqy45tjtrtmgcp4rx8d4pg1 -->

**A.** SoapGirls concerts canceled, including in Milwaukee, after racism claims
> _(no snippet captured)_

**B.** SoapGirls concerts canceled, including in Milwaukee, after racism claims
> _(no snippet captured)_

**Answer:** 

---

#### P105

<!-- pair: k97aq0m8kj01b3nwmnk92hap2h8d51bj|k97c0bnz1qwre2pt0w2jwkfwyh8d57w4 -->

**A.** Residents have one more week to apply for federal assistance for April flooding
> _(no snippet captured)_

**B.** Residents have one more week to apply for federal assistance for April flooding
> _(no snippet captured)_

**Answer:** 

---

#### P106

<!-- pair: k97bbjrg9bbywtx3ccafsg4v558d5bnn|k97ea4msg75xqmr9sswcvppv1d8d4w4e -->

**A.** FHLBank Chicago and WHEDA Recognize Housing Counseling Grants Supporting Milwaukee-Area Homebuyers
> _(no snippet captured)_

**B.** FHLBank Chicago and WHEDA Recognize Housing Counseling Grants Supporting Milwaukee-Area Homebuyers
> _(no snippet captured)_

**Answer:** 

---

#### P107

<!-- pair: k97c8bmj13aeevc9fg6tvtrnk98d45xw|k97d62trfn5t8kx6pvq3z9d0an8d47jj -->

**A.** Best Western Plus Milwaukee Airport Hotel & Conference ...
> A 8,10 kilómetros del histórico Third Ward, que cuenta con boutiques locales, galerías de arte, tiendas de moda y tiendas especializadas en el elegante distrito ...

**B.** Encuentre vuelos de Milwaukee a Nueva York
> Busca vuelos de Milwaukee a Nueva York? Encuentre las mejores tarifas con American Airlines y disfrute de una experiencia inigualable a bordo!

**Answer:** 

---
