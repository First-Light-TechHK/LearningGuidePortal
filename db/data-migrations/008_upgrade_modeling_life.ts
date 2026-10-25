import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";
import { validateLessonContents } from "../../services/lessonContent";

export const id = "008_upgrade_modeling_life";
export const description = "Add the Science Modeling life course with authored bilingual text, video points, resources, tests and preview configuration.";
export const touches = ["courses"] as const;

/** Source provenance and repository image checksums; no source-machine paths or environment secrets. */
export const modelingLifeImport = {
  "workbook": "modeling life课程信息.xlsx",
  "documents": [
    {
      "file": "Lesson 1 文本课件.docx",
      "sha256": "c28f42cde11321282ec13d4967708170cb1302c68e71f967c7e06a655cce431d",
      "points": [
        "1.1",
        "1.2",
        "1.3",
        "1.4",
        "1.5"
      ]
    },
    {
      "file": "Lesson 2文本课件.docx",
      "sha256": "4517201c287cb29d46944e7e7df1f32c79d10a4cc85a2b3a0a1345bde3ab94a7",
      "points": [
        "2.1",
        "2.2"
      ]
    }
  ],
  "images": [
    {
      "file": "lesson-1-image1.png",
      "sha256": "dd5e1ccb04dff99e5930bd8496343ea77f82ec6a3d8076d2a60825d20eb0d1eb",
      "bytes": 1780157
    },
    {
      "file": "lesson-1-image2.png",
      "sha256": "3c2307130142f66e1490b9e1b0e8fc2666d3f49a98b3447416aaa9028beb93f9",
      "bytes": 47933
    },
    {
      "file": "lesson-1-image3.png",
      "sha256": "02ada05e88ff91db2265b0d97e39a933782c35d7d190344bb9a1f12c38e71340",
      "bytes": 13769
    },
    {
      "file": "lesson-1-image4.png",
      "sha256": "e7cfe6150a1ffd1e7337e5fe948dfa1c04403cdb4169e5507dbe90132190002a",
      "bytes": 5714
    },
    {
      "file": "lesson-1-image5.png",
      "sha256": "d33beb0578a09cb1c680d7d717965dd1901926e4c3ca9d89a84a57728d8f701c",
      "bytes": 20043
    },
    {
      "file": "lesson-1-image6.png",
      "sha256": "9eee864b533864451541adf3106852121f5858b8498ed4cab8d1578bb4e6f486",
      "bytes": 585881
    },
    {
      "file": "lesson-1-image7.png",
      "sha256": "3de32ecf361abaa75993cb902c1571fc31dfafb59c67af648da1952175dfe4f8",
      "bytes": 18061
    },
    {
      "file": "lesson-1-image8.png",
      "sha256": "2a232ea7c2507df961897f59145df33d7310819a0ce91cdfb2a92d079bfeda47",
      "bytes": 20164
    },
    {
      "file": "lesson-1-image9.png",
      "sha256": "244b3347db229ce6badc938e9b829107e2b6b5aa1f6398e6ce6253ffe4406c31",
      "bytes": 12317
    },
    {
      "file": "lesson-1-image10.png",
      "sha256": "3c1ea429c4fb5ef68ec24996a4ec063ec72a56a42a34ec16708b43b5f98734ff",
      "bytes": 13042
    },
    {
      "file": "lesson-1-image11.png",
      "sha256": "87568640a78e693212d0ec9c4abe07c170805a64987d75f6474b7fa4997b7121",
      "bytes": 481622
    },
    {
      "file": "lesson-1-image12.png",
      "sha256": "e8f28c451fbe441fd973a0ccf678a98026a214cbfb609482eb43578a66c5bbe3",
      "bytes": 45720
    },
    {
      "file": "lesson-2-image11.png",
      "sha256": "582a088137019648b1a73d887cae6ae3778e2cf449680b3a2355ea704854ffad",
      "bytes": 64044
    },
    {
      "file": "lesson-2-image1.png",
      "sha256": "249bb28729d2b34eead446d7e87b34739547ac1c9cab1cef9b4804bead077236",
      "bytes": 149023
    },
    {
      "file": "lesson-2-image2.png",
      "sha256": "dad86d084ae88410320484133852296c0e6fbee41669b03543d6fa1a88bbcfdc",
      "bytes": 17162
    },
    {
      "file": "lesson-2-image3.png",
      "sha256": "26a768a2ba3a8d9091c9899b114f112c03677d8bd17de7a7c580bdfd0c92cb07",
      "bytes": 19980
    },
    {
      "file": "lesson-2-image4.png",
      "sha256": "aa1ef767bc109545000b3caf9201474271b4fb025490e7f341e7a686b0f80f8c",
      "bytes": 17946
    },
    {
      "file": "lesson-2-image5.png",
      "sha256": "01a6edc5d8a32dd1d794dfb1937155f71849fad409da471e64978622caba7531",
      "bytes": 38388
    },
    {
      "file": "lesson-2-image6.png",
      "sha256": "b2643d601c069ebc66d2722ec52bd33d1eecdc7ead2d5607d2d30888d4b95875",
      "bytes": 38824
    },
    {
      "file": "lesson-2-image7.png",
      "sha256": "ac51765316f4803aa550d17e2c821c8d864579d6b2f13e2c30f1ac049000e858",
      "bytes": 31104
    },
    {
      "file": "lesson-2-image8.png",
      "sha256": "d602ff938dd0a9a05c9114071dd95d2c2e15f7bf55e91ae3c38825a79f14b3f8",
      "bytes": 115939
    },
    {
      "file": "lesson-2-image9.png",
      "sha256": "ebfe3114ffece82ba818dd1c47ccb062608443a5c10aebb797a315ab6f0cb629",
      "bytes": 133084
    },
    {
      "file": "lesson-2-image10.png",
      "sha256": "18ef25aab0e28f25a1db389a7f0272a6acb39f21360aa6b0cf278870a0f95100",
      "bytes": 129318
    },
    {
      "file": "lesson-2-image12.png",
      "sha256": "da898cd19cd86185e4b08a1acebfc9774541c794eceba5a367763553add42eee",
      "bytes": 64986
    },
    {
      "file": "lesson-2-image13.png",
      "sha256": "b47c1d9545ad3fa2133537187f1730a2536f35f23c2d4745cbb294ee6a6b25f1",
      "bytes": 10515
    },
    {
      "file": "lesson-2-image14.png",
      "sha256": "2155d37dd487ae1b8e2dc2f4324fc4d81a5c249995c4f29397f7b58d932f6b81",
      "bytes": 10646
    },
    {
      "file": "lesson-2-image15.png",
      "sha256": "60a2bbd375c4681fa8266352548779c98933be0a3d96e75c618575c3c7f15499",
      "bytes": 25224
    },
    {
      "file": "lesson-2-image16.png",
      "sha256": "d0ce14eb038dc1f707766639edd54cc71d6cd1b7395dcdba64befba74a7fa336",
      "bytes": 19282
    },
    {
      "file": "lesson-2-image17.png",
      "sha256": "6646b8834abe529e63ac48d658a7d3ae5c490d68d599e0ed95d45e7a02366d53",
      "bytes": 196412
    },
    {
      "file": "cover.png",
      "sha256": "4d2b4be71b156133e8bed82aa8c407642545d7e7f1121f4272214eaa9c7919e0",
      "bytes": 1750526
    },
    {
      "file": "lesson1-exhibit-1-s.png",
      "sha256": "155bbcc37b52f15f648c0845fbfa1f947442250e4bdbfb91dc2855d66afdd454",
      "bytes": 1504663
    },
    {
      "file": "lesson1-exhibit-1.png",
      "sha256": "6ef3c553b4e5965f6a349d8e7a8ab92e37808a561287eb09fdd9c6f49c6f0f28",
      "bytes": 1207457
    },
    {
      "file": "lesson1-exhibit-2-s.png",
      "sha256": "3ffacd3dd1019fb22cf9bdb5ee4b7234873d912028cff8f3c7dac4746867d7bc",
      "bytes": 1158424
    },
    {
      "file": "lesson1-exhibit-2.png",
      "sha256": "d8970eece1dd265917cbe39db7fde832b4ccd69da02b04e841c53dd12abbc268",
      "bytes": 908422
    }
  ],
  "videoUrls": {
    "lesson1": "/api/course-media/modeling-life/04f0039b-42c7-441b-85b7-fe6e21c6bbe6",
    "lesson2": "/api/course-media/modeling-life/613a07b1-24e8-4123-ab10-5bd36875293e"
  },
  "videoIsTemporary": false,
  "sourceVideos": [
    {
      "name": "Lesson 1视频课件.mp4",
      "durationSeconds": 1469
    },
    {
      "name": "Lesson 2视频课件.mp4",
      "durationSeconds": 1584
    }
  ],
  "timeConvention": "Excel h:mm display interpreted as video minutes:seconds; start/exhibit times are absolute in the source video.",
  "warnings": []
};

const sourceCourse = {
  "id": "modeling-life",
  "slug": "modeling-life",
  "title": "Modeling life",
  "subtitle": "See how mathematics models life, from population growth to neural activity and disease. Simulate real biological systems with Euler’s method, no prior background in differential equations required.",
  "description": "Centred on dynamical systems and feedback, it shows how differential equations underpin homeostasis, population dynamics, neural activity and disease — the very competencies flagged as essential by HHMI/AAMC, and the NSF/AAAS Vision and Change initiative. Rather than mastering by-hand calculus techniques, students learn to simulate systems computationally using Euler's method, requiring no prior background in differential equations. Real examples from physiology, ecology, neuroscience and immunology anchor every concept, starting from day one with a predator–prey ecosystem. The result is a practical, intuitive fluency in dynamical thinking that prepares students for further study and research across the life sciences.",
  "category": "Science",
  "cover": "/courses/modeling-life/cover.png",
  "thumbnailPath": "/courses/modeling-life/cover.png",
  "outcomes": [
    "Model real biological systems mathematically.",
    "Learn the basics of a programming language",
    "Explore dynamics across disciplines",
    "Simulate nonlinear dynamics with Euler's method",
    "Understand positive and negative feedback",
    "Build the competencies future physicians and researchers"
  ],
  "features": [
    "Video & text dual-mode learning",
    "Multiple reference exhibits",
    "AI-powered learning assistant",
    "AI-guided deep comprehension",
    "Extended readings for context",
    "Bilingual: 中文 / English"
  ],
  "authorIds": [],
  "status": "published",
  "sections": [
    {
      "id": "modeling-life-foundations",
      "title": "Modeling life",
      "lessons": [
        {
          "id": "modeling-life-lesson-1",
          "title": "State Spaces, Vector Spaces and Trajectories",
          "summary": "A system can be thought of as a collection of states at different times.",
          "body": "",
          "durationMinutes": 25,
          "videoDurationSeconds": 1469,
          "isPublic": true,
          "preview": {
            "textPointCount": 1,
            "videoLimitSeconds": 600
          },
          "contents": [
            {
              "id": "modeling-life-l1-text-1",
              "title": "State Variables and State Spaces",
              "type": "text",
              "mode": "lecture",
              "exhibitMode": "authored",
              "html": "<p>State Spaces, Vector Spaces and Trajectories</p><p>状态空间、向量空间与轨迹</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-1-image1.png\" /></p><p><em>Exhibit 1.1  Constellation diagram used as an introductory illustration</em></p><p><em>展品 1.1  用于开篇引入的星座连线图</em></p></td></tr></table><p><strong>1.1 状态变量与状态空间</strong></p><p>S: I’m trying to understand how to model systems over time, but I’m not sure where to start. What does a “state” actually mean?</p><p>S（中文）：我在尝试理解如何对系统随时间的变化进行建模，但不知道从哪里入手。“状态”到底是什么意思？</p><p>T: To understand system dynamics and how systems change over time, we will develop a basic mathematical framework to help understand this.</p><p>T（中文）：为了理解系统动力学以及系统如何随时间变化，我们将建立一个基础数学框架来帮助理解。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-1-image2.png\" /></p><p><em>Exhibit 1.2  A cup of coffee described by four state variables (T, W, V, C): temperature = 63.1 °C, weight = 128 g, volume = 470 ml, caffeine concentration = 20 mg/oz</em></p><p><em>展品 1.2  一杯咖啡由四个状态变量 (T, W, V, C) 描述：温度 63.1 °C、重量 128 g、体积 470 ml、咖啡因浓度 20 mg/oz</em></p></td></tr></table><p>Our first example is going to be a single number. We will define a state as a number that characterizes the system at a time. For example, suppose we are studying a cup of coffee in a room. The state could be where it is in the room, the amount of coffee in the cup, or its temperature. In this particular example, the temperature, T, is chosen as the state of the cup of coffee at a time.</p><p>我们的第一个例子将是一个单一的数值。我们将状态定义为：在某一时刻刻画系统的一个数。例如，假设我们在研究房间里的一杯咖啡。状态可以是它在房间里的位置、杯中咖啡的量，或者它的温度。在这个具体例子中，我们选择温度 T 作为这杯咖啡在某一时刻的状态。</p><p>S: So in our example here, the only variable we will be looking at is the temperature and nothing else?</p><p>S（中文）：所以在我们这个例子里，我们唯一关注的变量就是温度，其他都不考虑？</p><p>T: Yes, that is correct. In our example, temperature is the state of the cup of coffee at a certain time.</p><p>T（中文）：是的，没错。在我们的例子中，温度就是咖啡杯在某一特定时刻的状态。</p><p>S: I understand that the temperature is a characteristic of the system, which in this case is the cup but why do we only pick one variable? Doesn’t that ignore other important aspects of the system?</p><p>S（中文）：我明白温度是系统（在这里是咖啡杯）的一个特征，但为什么我们只选一个变量？这样不会忽略系统的其他重要方面吗？</p><p>T: We choose temperature and not the amount of coffee or some other variable that describes the system because, in this case, the interest is in the temperature of the cup of coffee. If the interest were in how fast it was evaporating, a different state variable would probably be chosen. The volume might be chosen or the weight of the coffee in the cup. If the interest were in how strong the coffee was, then some ratio of the amount of coffee to the amount of liquid, such as mg per oz, might be chosen. But in this case, it is just going to be a single variable, T, and T is going to be the temperature. That temperature is going to change over time and give us the development of the system.</p><p>T（中文）：我们选择温度，而不是咖啡的量或其他描述系统的变量，是因为在这个例子里，我们感兴趣的是咖啡杯的温度。如果关注的是蒸发速度，可能就会选择另一个状态变量。可能会选择体积，或者杯中咖啡的重量。如果关注的是咖啡的浓淡，那么可能会选择咖啡量与液体量之比，例如毫克每盎司（mg per oz）。但在这个例子中，我们只考虑一个变量 T，T 就是温度。这个温度会随时间变化，从而展示系统的演化。</p><p>S: Do these state variables always have units, or can they just be abstract numbers?</p><p>S（中文）：这些状态变量总是有单位吗？还是可以是纯粹的抽象数字？</p><table><tr><td><p>States variables always have units.</p><p>In order for a system to be mathematically tractable, its states must be described using numbers and a unitized measurement standard.</p><p><em>Exhibit 1.3  States Have Units</em></p><p><em>展品 1.3  状态具有单位</em></p></td></tr></table><p>T: The first point we have to make about states is that states have units. In this case, temperature will be measured in degrees Kelvin, which is an absolute temperature scale. If we were measuring the amount of coffee left, the volume of the cup of coffee could be measured by its mass in grams or its volume in cubic inches. Different variables obviously require different units, but states always have units.</p><p>T（中文）：关于状态，我们要强调的第一点是：状态有单位。在这个例子中，温度用开尔文度量，这是一种绝对温标。如果要测量剩下的咖啡量，咖啡杯的体积可以用克（质量）或立方英寸（体积）表示。不同的变量显然需要不同的单位，但状态总是有单位的。</p><p>S: So this applies beyond physical systems like coffee? What about electricity or biological systems, such as animal populations?</p><p>S（中文）：那这不仅仅适用于咖啡这样的物理系统吧？电力系统或生物系统（比如动物种群）呢？</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-1-image3.png\" /></p><p><em>Exhibit 1.4  Three examples of one-dimensional state spaces: voltage, population size, and the fraction of a wolf population that has black fur</em></p><p><em>展品 1.4  一维状态空间的三个例子：电压、种群数量，以及狼群中黑毛个体的比例</em></p></td></tr></table><p>T: Yes, that is the case. With electricity, the state variable might be voltage. We could also be looking at an animal population and studying birth and death, along with the ecological changes that occur. In that case, x might equal the number of animals, again always at time t. That goes without saying. The unit in this case is the number of animals, such as bears or rabbits, depending on what is being studied. This can also be modelled for insulin-glucose models and susceptible-infected human models.</p><p>T（中文）：是的，正是如此。在电力系统中，状态变量可能是电压。我们也可以研究动物种群，分析出生、死亡以及随之而来的生态变化。在这种情况下，x 可以等于动物的数量，同样也是在时刻 t 的数量。这毋庸赘言。此时的单位就是动物的数量，比如熊或兔子，取决于研究对象。同样的方法也可以用于胰岛素–血糖模型和易感–感染人群模型。</p><p>We now have this concept of just a single variable as a state. The term variable is used because these are also called state variables. The state variable for the coffee system in this particular case is temperature, because that is what is being studied.</p><p>我们现在有了“单一变量作为状态”的概念。之所以用“变量”这个词，是因为它们也被称为状态变量。在这个咖啡系统的例子中，状态变量就是温度，因为这是我们正在研究的对象。</p><p>S: Do “state” and “state variable” mean the same thing?</p><p>S（中文）：“状态”和“状态变量”是同一个意思吗？</p><table><tr><td><p>A dynamic system comprises a collection of states at different times.</p><p>A state variable measures a state, using a relevant unit system, at a particular time.</p><p><em>Exhibit 1.5  Dynamic System and State Variable</em></p><p><em>展品 1.5  动态系统与状态变量</em></p></td></tr></table><p>T: Not quite. A dynamic system changes over time and these changes are conceived of a collection of states at particular times. Which type of state we choose depends on what it is that we are trying to understand. The state variable is the measurement of that state. So the state variables in our examples are T, the temperature, or x, the number of animals.</p><p>T（中文）：不一定。系统的状态肯定取决于我们想理解什么。所以在这些例子中，状态变量是 T（温度）或者 x（动物数量）。</p><p>S: What does this look like visually? Is there some kind of graph?</p><p>S（中文）：这在视觉上是什么样的？有图吗？</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-1-image4.png\" /></p><p><em>Exhibit 1.6  A one-dimensional state axis: the state is X = 4 at time t₁ and X = 6 at time t₂</em></p><p><em>展品 1.6  一维状态轴：时刻 t₁ 状态为 X = 4，时刻 t₂ 状态为 X = 6</em></p></td></tr></table><p>T: The state is associated with a geometric construction known as the state space, which is a geometric picture of the set of all possible states.</p><p>T（中文）：状态与一个被称为“状态空间”的几何构造相关联，状态空间是所有可能状态组成集合的几何图像。</p><p>A point in state space represents the state of a system at a time. We also see a theme that will appear often in the next week: the change of state of a system is a movement from one state point to another state point, and that is how the system evolves over time.</p><p>状态空间中的一个点代表系统在某一时刻的状态。我们还会看到一个在接下来经常出现的主题：系统状态的变化就是从某一个状态点移动到另一个状态点，而系统正是这样随时间演化的。</p><p>S: I now understand how it works if there is only one variable in the system. But in reality, many systems have more than just one variable for it to make sense, so what happens if a system needs more than one variable?</p><p>S（中文）：我现在理解了单变量系统是怎么工作的。但在现实中，很多系统需要多个变量才有意义，如果一个系统需要不止一个变量会怎样？</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-1-image5.png\" /></p><p><em>Exhibit 1.7  Three two-dimensional state spaces: shark–tuna space, insulin–glucose space, and susceptible–infected space</em></p><p><em>展品 1.7  三个二维状态空间：鲨鱼–金枪鱼空间、胰岛素–血糖空间，以及易感–感染人群空间</em></p></td></tr></table><p>T: Well let’s think about modelling the animal population again but for sharks and tunas. The number of sharks, S, and the number of tuna, T, describe the state of a system at a time. So we are led to this concept of a two-tuple, or pair. A two-tuple of states, (S, T), is necessary to describe the state of the shark-tuna system at a time.</p><p>T（中文）：那让我们再想想种群模型，不过这次换成鲨鱼和金枪鱼。鲨鱼的数量 S 和金枪鱼的数量 T 描述了系统在某一时刻的状态。于是我们引入了“二元组”，也就是“对”的概念。一个由两个状态组成的二元组 (S, T) 是描述某一时刻鲨鱼–金枪鱼系统状态所必需的。</p><p>S: So what does that look like as a space? A single variable gives a one-dimensional space, but what about two variables? Would that be given in a two dimensional space?</p><p>S（中文）：那作为“空间”它长什么样？单变量给出一维空间，那两个变量呢？也是二维空间吗？</p><p>T: Yes, like you said a single variable gives a one dimensional space whilst a pair of variables needs two dimensions, S and T, to describe the state of the system. The point (S0, T0) is plotted as a point in S-T space. Here is S0, here is T0, and here is the point (S0, T0) in S-T space. This point in S-T space represents the state of the shark-tuna system at a point in time. Two variables are represented by a two-tuple, and that this two-tuple is in turn represented as a point in the two-dimensional shark-tuna space. The phrase shark-tuna space will be used often.</p><p>T（中文）：是的，正如你所说，单变量给出一维空间，而一对变量需要 S 和 T 两个维度来描述系统的状态。点 (S0, T0) 被画在 S–T 空间中。这是 S0，这是 T0，这是 S–T 空间中的点 (S0, T0)。S–T 空间中的这个点代表了某一时刻鲨鱼–金枪鱼系统的状态。两个变量用二元组表示，而这个二元组又表示为二维鲨鱼–金枪鱼空间中的一个点。“鲨鱼–金枪鱼空间”这个短语我们会经常用到。</p><p>S: So if someone asked how the shark-tuna system is doing right now, what would the answer to that be?</p><p>S（中文）：那要是有人问现在的鲨鱼–金枪鱼系统状况如何，该怎么回答？</p><p>T: The answer would be that the shark-tuna system is at the point (S0, T0), where S0 is the actual number of sharks at this time and T0 is the actual number of tuna at this time. In a two-variable system, two state variables are needed. They are represented in a fixed way, with parentheses around them and a comma between them. That is the two-tuple (S, T), representing sharks and tuna.</p><p>T（中文）：答案就是：鲨鱼–金枪鱼系统处于点 (S0, T0)，其中 S0 是此刻鲨鱼的真实数量，T0 是金枪鱼的真实数量。在一个双变量系统中，需要两个状态变量。它们以固定方式表示：用括号括起来，中间用逗号隔开。这就是二元组 (S, T)，代表鲨鱼和金枪鱼。</p><p>S: Is this “space” that you are talking about a real physical space like the ocean?</p><p>S（中文）：你说的这个“空间”是像海洋那样的真实物理空间吗？</p><p>T: No, the shark-tuna space is not the ocean. When we talk about spaces here, it has nothing to do with physical space. It is an abstract space spanned by the two variables S and T, and a point in it represents a certain number of sharks and a certain number of tuna at a time. For example, we can talk about other two-tuple state spaces, such as the insulin – glucose space, an important  feedback process in the human digestive system, or the susceptibles – infected space that is used to describe epidemics</p><p>T（中文）：不是，鲨鱼–金枪鱼空间不是海洋。我们在这里谈论的空间与物理空间无关。它是由 S 和 T 两个变量张成的抽象空间，其中每个点代表某一时刻特定数量的鲨鱼和特定数量的金枪鱼。例如，我们还可以谈论其他的二元组状态空间，比如胰岛素–血糖空间——人体消化系统中一个重要的反馈过程——或者用于描述疫情的易感–感染人群空间。</p>",
              "nodes": []
            },
            {
              "id": "modeling-life-l1-text-2",
              "title": "Defining Vectors",
              "type": "text",
              "mode": "lecture",
              "exhibitMode": "authored",
              "html": "<p><strong>1.2 Defining Vectors</strong></p><p><strong>1.2 向量的定义</strong></p><p>S: I now know that one and two variable systems exist. But if two variable systems exist, wouldn’t it make sense for three variable systems to exist too?</p><p>S（中文）：我现在知道存在单变量和双变量系统。但如果双变量系统存在，三变量系统也应该存在吧？</p><p>T: Yes, so let’s now introduce a third variable into the system, where the tuna survived by eating plankton. Now we have a three-variable system. It is represented by a three-tuple. At a particular point in time, it's S0, T0, P0: a certain number of sharks, a certain number of tuna, and a certain number of plankton. A certain point within the system can be represented by a three-tuple or more technically, a three-vector. When we have n variables, we will have an n-vector.</p><p>T（中文）：是的，那让我们给系统引入第三个变量：金枪鱼靠吃浮游生物生存。现在我们有了一个三变量系统。它用一个三元组表示。在某一特定时刻，就是 S0、T0、P0：一定数量的鲨鱼、一定数量的金枪鱼和一定数量的浮游生物。系统中的一个特定点可以用三元组表示，更专业地说，是一个三维向量。当有 n 个变量时，我们就有一个 n 维向量。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-1-image6.png\" /></p><p><em>Exhibit 1.8  A three-dimensional state space with shark, tuna and plankton axes, and a state vector drawn from the origin</em></p><p><em>展品 1.8  以鲨鱼、金枪鱼、浮游生物为轴的三维状态空间，并画出一个从原点出发的状态向量</em></p></td></tr></table><p>S: So the three numbers are like coordinates?</p><p>S（中文）：所以这三个数字就像坐标一样？</p><p>T: Yes, geometrically, we have a shark axis, we have a tuna axis, and now we have a plankton axis. A point in shark-tuna-plankton space, S0, T0, P0, is a certain number of sharks, tuna and plankton.</p><p>T（中文）：是的，从几何上看，我们有鲨鱼轴、金枪鱼轴，现在又有了浮游生物轴。鲨鱼–金枪鱼–浮游生物空间中的点 S0、T0、P0 代表一定数量的鲨鱼、金枪鱼和浮游生物。</p><p>S: Does the 0 in these numbers mean that the population of these animals is 0?</p><p>S（中文）：这些数字里的下标 0 是不是表示这些动物的数量为 0？</p><p>T: In the state space S0, T0, P0, that zero is just an index number and it does not mean that the number of sharks is zero. The zero here means that this is the first instance, and we start numbering with zero. That's the first instance of our state point. S0 could be 500, T0 could be 38, and P0 could be 2,400. So this is the three-tuple that represents the state of the system at a time, and this is, of course, our three-vector.</p><p>T（中文）：在状态空间 S0、T0、P0 中，这个 0 只是一个索引编号，并不意味着鲨鱼数量为零。这里的 0 表示这是第一个实例，我们从零开始编号。这是状态点的第一个实例。S0 可能是 500，T0 可能是 38，P0 可能是 2400。所以这个三元组代表了系统在某一时刻的状态，当然也就是我们的三维向量。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-1-image7.png\" /></p><p><em>Exhibit 1.9  A point (3, 7) in the shark–tuna plane, shown as a dot (left) and as an arrow from the origin (right)</em></p><p><em>展品 1.9  鲨鱼–金枪鱼平面上的点 (3, 7)：左图为黑点表示，右图为从原点出发的箭头表示</em></p></td></tr></table><p>Vectors in an abstract X-Y space have both magnitude and direction. The state point S0, T0, P0 can be thought of as the tip of the vector. So the terminology \"vectors as arrows\" has exactly the same information as \"vectors as state points.\" Because given the state point, it's easy to draw the arrow. It's trivial to draw the arrow from the origin to the state point. That has the same information. And given the arrow, you just take the tip of it and call that the state point.</p><p>抽象 X–Y 空间中的向量既有大小也有方向。状态点 S0、T0、P0 可以看作向量箭头的尖端。因此，“向量作为箭头”与“向量作为状态点”所包含的信息完全相同。因为给定状态点，很容易画出箭头；从原点向状态点画一个箭头更是轻而易举。这包含同样的信息。反过来，给定箭头，你只要取它的尖端，那就是状态点。</p><p>S: What if there are more than three variables how will we be able to visualize it?</p><p>S（中文）：如果变量超过三个，我们怎么可视化它？</p><p>T: We cannot visualise it in our heads but that isn’t to say that they do not exist. Let me give you an example of a neuron. When you study the neuron, you will learn that the neuron is characterized by a voltage, by a sodium concentration, by a potassium concentration, and by a calcium concentration. So the state of the neuron at a time is represented by a four-tuple, or a four-vector. However, we cannot draw this as there is no way of representing four variables simultaneously on a two-dimensional graph, which is all we have. Despite this, there is nothing wrong with the concept of four-space and we can still operate it mathematically.</p><p>T（中文）：我们无法在脑海中可视化，但这并不意味着它们不存在。让我举一个神经元的例子。当你学习神经元时，你会了解到神经元由电压、钠离子浓度、钾离子浓度和钙离子浓度来刻画。因此，神经元在某一时刻的状态用一个四元组，也就是四维向量来表示。然而，我们无法把它画出来，因为我们无法在二维图像上同时表示四个变量，而我们只有二维图。尽管如此，四维空间的概念没有任何问题，我们仍然可以在数学上处理它。</p>",
              "nodes": []
            },
            {
              "id": "modeling-life-l1-text-3",
              "title": "State Space Rules for Operating with Vectors",
              "type": "text",
              "mode": "lecture",
              "exhibitMode": "authored",
              "html": "<p><strong>1.3 State Space Rules for Operating with Vectors</strong></p><p><strong>1.3 状态空间中的向量运算规则</strong></p><p>S: How do we actually work with vectors once we have them?</p><p>S（中文）：一旦有了向量，我们实际上如何操作它们？</p><p>T: We can use a vector space to help us operate with them. The vector space is defined by the variables and by two very important rules for operating with vectors.</p><p>T（中文）：我们可以用向量空间来帮助操作。向量空间由变量以及两条非常重要的向量运算规则来定义。</p><table><tr><td><p><strong>Two Vector Operations</strong></p><p>Addition</p><p>Vector 1 (X1 , Y1 ) + Vector 2 (X2 , Y2 ) = Vector 3 (X1+2 , Y1+2)</p><p>Multiplication</p><p>Vector 1 X Vector 2: nonsensical</p><p>Scalar Vector 1 (X1 , Y1 ) = Vector 1 (scalar X1 , scalar Y1 )</p><p><em>Exhibit 1.10  Two Vector Operations</em></p><p><em>展品 1.10  向量的两种运算</em></p></td></tr></table><p>The first rule is called addition. If we have one variable, let's call it X. X is the variable. And let's say that two values of X are x1 and x2. Now of course, that also means that those are two different points in the one-dimensional vector space. But right now, we will just see them as two variables.</p><p>第一条规则叫做加法。如果我们有一个变量，称之为 X。X 就是这个变量。再假设 X 的两个取值为 x1 和</p><p>x2。当然，这也意味着它们是一维向量空间中的两个不同点。但现在，我们先把它们看作两个变量。</p><p>S: When we add them, are we just treating them like ordinary numbers, or is there a special vector rule here?</p><p>S（中文）：当我们相加时，是把它们当作普通数字处理，还是有特殊的向量规则？</p><p>T: That’s more or less what you do but you must ensure that the same components are added to each other. If x1 is a vector and x2 is a vector, we can make a third vector called x1 plus x2. And we know how to add these two things because they are two numbers, and we know how to add numbers. So we know how to add two vectors to get a third vector in the same space.</p><p>T（中文）：差不多就是那样，但你必须确保相同的分量彼此相加。如果 x1 是向量，x2 也是向量，我们可以构造第三个向量，称为 x1 加 x2。我们知道如何相加，因为它们是两个数，而我们知道如何加数。所以，我们知道如何把两个向量相加，得到同一空间中的第三个向量。</p><p>The second rule is called multiplication, where we will multiply vectors by numbers. If x1 is the temperature and x2 is a temperature, what is the product of two temperatures? We have no idea, which is why in general we do not multiply vectors together. So if a is a number and x1 is a vector, then the product would be ax1. Again, because we know how to multiply a number by a number: where a is a number and x1 is also a number, we know how to multiply two numbers. And so a times x1 is going to be some other vector x2, and that's also going to be an element of the space.</p><p>第二条规则叫做乘法，即向量与数相乘。如果 x1 是温度，x2 也是温度，那么“两个温度相乘”是什么？我们不知道，这就是为什么通常我们不把向量彼此相乘。因此，如果 a 是一个数，x1 是一个向量，那么乘积就是 a x1。同样，因为我们知道如何把数与数相乘：a 是数，x1 也是数，我们知道如何乘两个数。所以 a 乘以 x1 会得到另一个向量 x2，它也是这个空间中的元素。</p><p>So these are the two principle rules for dealing with vectors: addition of two vectors, and multiplication of a vector by a number.</p><p>以上就是处理向量的两条主要规则：两个向量相加，以及向量与数相乘。</p><p>When we multiply this vector by this number here, the fancy name for this number is a scalar.</p><p>当我们用这个数去乘向量时，这个数的高端名称叫“标量”。</p><p>S: So what is a scalar? Is it just a plain number, does it carry any meaning behind it? Likewise, does the vector carry meaning or units?</p><p>S（中文）：那什么是标量？它就是一个普通数字吗？它背后有什么含义？同样，向量有含义或单位吗？</p><p>T: So a scalar is just a number that we multiply. It has no units. We multiply the vector by the scalar to get a new number of animals or temperature or whatever. These are the rules for adding vectors and multiplying a vector by a scalar in one dimension.</p><p>T（中文）：标量就是我们所乘的那个数。它没有单位。我们用标量去乘向量，得到新的动物数量、温度或别的什么。这些就是一维情况下向量相加以及向量与标量相乘的规则。</p><p>S: Does the same idea still work if there are more variables or do some of the rules change?</p><p>S（中文）：如果变量更多，同样的想法还适用吗？还是有些规则会改变？</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-1-image8.png\" /></p><p><em>Exhibit 1.11  Vector addition: the green vector (1, 3) plus the blue vector (8, 4) gives the red resultant vector</em></p><p><em>展品 1.11  向量加法：绿色向量 (1, 3) 加上蓝色向量 (8, 4)，得到红色的合向量</em></p></td></tr></table><p>T: Let me give you an example to help you visualise this. Let's take a shark-tuna case where we have one state vector representing (S1, T1)—certain number of sharks and a certain number of tuna—and we want to add to it a second state vector which we are going to call (S2, T2). How do we add two-dimensional state vectors?</p><p>T（中文）：让我举一个例子帮你可视化。我们来看鲨鱼–金枪鱼的情形：有一个状态向量表示 (S1, T1)——一定数量的鲨鱼和一定数量的金枪鱼——我们想给它加上第二个状态向量，称之为 (S2, T2)。如何相加两个二维状态向量呢？</p><p>S: I’m guessing we add each part separately, but I’m not sure if that is actually allowed?</p><p>S（中文）：我猜是分别把每一部分相加，但我不确定这是否允许？</p><p>T: There is no automatic answer to this question, but there is an answer. The answer is: we define the sum of two vectors by adding them component-wise. So the sum of (S1, T1) and (S2, T2) is going to be the new state vector which we will call (S3, T3), and that's going to be equal to (S1 + S2, T1 + T2). So we add the S components, we add the T components. That is the sum of two vectors. We say that vectors add component-wise. If there are three components, we're working in a three-dimensional system. Same thing: (S1, T1, P1) plus (S2, T2, P2) is equal to (S1 + S2, T1 + T2, P1 + P2). Vector addition is commutative.</p><p>T（中文）：这个问题没有自动的答案，但确实有答案。答案是：我们按分量定义两个向量的和。所以 (S1, T1) 与 (S2, T2) 的和将是一个新的状态向量，称之为 (S3, T3)，它等于 (S1 + S2, T1 + T2)。也就是说，S 分量相加，T 分量相加。这就是两个向量的和。我们说向量按分量相加。如果有三个分量，我们就在三维系统中处理。同理：(S1, T1, P1) 加 (S2, T2, P2) 等于 (S1 + S2, T1 + T2, P1 + P2)。向量加法满足交换律。</p><p>S: Okay, so we must add them by components but in the end we will still obtain a vector that is in the same dimensions. But what does commutative mean?</p><p>S（中文）：好的，所以我们必须按分量相加，但最终得到的仍然是同一维度的向量。不过“交换律”是什么意思？</p><p>T: Whether we add the first vector to the second vector or vice versa would still lead to the same final vector.</p><p>T（中文）：无论是把第一个向量加到第二个向量，还是反过来，都会得到相同的最终向量。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-1-image9.png\" /></p><p><em>Exhibit 1.12  Scalar multiplication of a vector A by 2, 0.5, −1 and −0.5</em></p><p><em>展品 1.12  向量 A 与 2、0.5、−1 和 −0.5 相乘的标量乘法</em></p></td></tr></table><p>S: But how do we work with multiplication? When we perform scalar multiplication, will it just scales each component equally?</p><p>S（中文）：但乘法怎么操作？进行标量乘法时，是每个分量等比例缩放吗？</p><p>T: In terms of multiplication, if a is a scalar and (S, T) is a two-dimensional state vector, we define a times (S, T) as (a times S, a times T). And that also makes sense, because if you think about a certain number of sharks and a certain number of tuna, and I say I want to take a patch of ocean that is twice as big as the previous—I want to multiply it by two—and everything else is homogeneous, what would I expect to see? I would expect to see twice as many sharks and twice as many tuna. So a times (S, T) is equal to (aS, aT).</p><p>T（中文）：关于乘法，如果 a 是标量，(S, T) 是二维状态向量，我们定义 a 乘以 (S, T) 等于 (aS, aT)。这也很合理，因为你可以想象有一定数量的鲨鱼和一定数量的金枪鱼，如果我说我要取一片比原来大两倍的海域——也就是乘以二——其他条件都均匀，你会看到什么？鲨鱼和金枪鱼都会变成原来的两倍。所以 a 乘以 (S, T) 等于 (aS, aT)。</p><p>S: So in one dimension, are we just dealing with ordinary numbers again?</p><p>S（中文）：那一维情况下，我们又回到普通数字了吗？</p><p>T: So first of all, we will look in 1D where we have a state variable X and the state space is X-space. We're going to have two values here: x1 and x2. In this case, of course, our state space—because it's animals—has only non-negative numbers, because negative numbers of rabbits just don't make sense. So our state space for physical reasons is confined to the non-negative numbers.</p><p>T（中文）：首先，我们来看一维情况，其中有一个状态变量 X，状态空间就是 X 空间。这里有两个值：x1 和 x2。当然，因为研究的是动物，我们的状态空间只包含非负数，因为负数的兔子没有意义。所以出于物理原因，我们的状态空间被限制在非负数范围内。</p><p>S: When you add them geometrically, is that the same as tip-to-tail addition from vectors?</p><p>S（中文）：从几何上看，把它们相加是不是和向量的首尾相接加法一样？</p><p>T: So we talked about how to add x1 plus x2 just by adding two numbers, but it's sort of interesting to look at that geometrically. We're going to take this arrow which is the arrow representing the state point x1, and we're going to go over to x2, and we're just going to add this arrow right onto x2. And this new point here—this is the point x1 plus x2. We're just going to add those two arrows by just putting them tip to tail. That's the geometric version of addition.</p><p>T（中文）：我们谈过如何把 x1 加 x2 仅仅通过两个数相加，但从几何角度看这很有意思。我们要把这个代表状态点 x1 的箭头拿过来，放到 x2 上，然后把这个箭头直接加到 x2 上。这个新点——就是 x1 加 x2。我们就是把这两个箭头首尾相接相加。这就是加法的几何版本。</p><p>S: So what about scalar multiplication? What does that do geometrically?</p><p>S（中文）：那标量乘法呢？几何上它做什么？</p><p>T: Let’s try starting with a state x1. We're going to multiply that by a scalar. What does that correspond to geometrically? Well, here is the vector x1, and ax1 is just the vector whose length is a times the x1 length. So if a is 2, then ax1 is going to look like what is shown below. If a is 3, it's going to be even longer. If a is 10, it's going to be longer. If a is 10.5, it's going to be longer still—nothing wrong with fractional scalar values. And interestingly, if a is less than one, then a times x1 is smaller than x1.</p><p>T（中文）：让我们从状态 x1 开始。我们要把它乘以一个标量。这在几何上对应什么？看，这是向量 x1，而 a x1 就是一个长度等于 x1 长度 a 倍的向量。所以如果 a 是 2，a x1 就会像下面这样。如果 a 是 3，它会更长。如果 a 是 10，它还会更长。如果 a 是 10.5，它会更长——分数标量值也没有问题。有趣的是，如果 a 小于 1，那么 a 乘以 x1 就比 x1 短。</p><p>So we have now successfully shown the equivalence between the geometric construct and the algebraic construct for adding vectors in one dimension and for scalar multiplication of vectors in one dimension.</p><p>这样，我们就成功展示了一维向量相加以及一维向量标量乘法的几何构造与代数构造之间的等价性。</p><p>S: So when the value of the scalar is larger than 1, the vectors gets longer. But what does scalar multiplication do geometrically if the scalar is smaller than 1 or even negative?</p><p>S（中文）：那么当标量值大于 1 时，向量会变长。但如果标量小于 1，甚至为负，标量乘法在几何上会怎样？</p><p>T: When multiplying vectors, if the scalar is larger than 1, the vector is stretched out in the same direction by an amount equal to the scalar. When a is smaller than 1, it acts as a shrinker and the resultant vector is shorter.</p><p>T（中文）：在向量乘法中，如果标量大于 1，向量会沿原方向被拉伸，拉伸倍数等于该标量。当 a 小于 1 时，它起压缩作用，结果向量更短。当 a 为负时，假设 X–Y 平面可以取负值，向量会指向相反方向，即翻转向量。这一点对更高维的向量同样适用。</p><p>When a is negative assuming the X-Y plane can take on negative values, the vector will then point to the opposite direction, flipping the vector. The same applies for vectors in a higher number of dimensions.</p><p>当 a 为负时，假设 X–Y 平面可以取负值，向量会指向相反方向，即翻转向量。这一点对更高维的向量同样适用。</p>",
              "nodes": []
            },
            {
              "id": "modeling-life-l1-text-4",
              "title": "Vectors And Vector Spaces",
              "type": "text",
              "mode": "lecture",
              "exhibitMode": "authored",
              "html": "<p><strong>1.4 Vectors And Vector Spaces</strong></p><p><strong>1.4 向量与向量空间</strong></p><p>T: In one dimension, the state vector is just a vector X, represented as a single number X. The X we are talking about is just a number, or as it's called in math, a real number.</p><p>T（中文）：在一维中，状态向量就是向量 X，表示为一个数 X。我们这里说的 X 就是一个数，或者数学上所说的实数。</p><table><tr><td><table><tr><td><p><strong>Real Numbers</strong></p></td><td><p><strong>Complex Numbers</strong></p></td></tr><tr><td><p>ℝ</p></td><td><p>a + bi</p></td></tr><tr><td><p>1, 2 ½ , -1, 1.00236, π</p></td><td><p>a and b are real numbers, i =√-1</p></td></tr></table><p><em>Exhibit 1.13  Real Numbers / Complex Numbers</em></p><p><em>展品 1.13  实数 / 复数</em></p></td></tr></table><p>S: What is a real number? Is it just any normal number we use in this space?</p><p>S（中文）：什么是实数？它就是我们在这个空间里用的普通数字吗？</p><p>T: Real numbers include every number that you are able to think of - fractions, integers, square roots, pi etc. Real numbers are equivalent to points on the geometric one-dimensional line. The infinite line is the geometric picture of the real numbers. In maths, the symbol for real numbers is written as an R with a double vertical part.</p><p>T（中文）：实数包括你能想到的所有数——分数、整数、平方根、π 等等。实数等价于一维几何直线上的点。这条无限延伸的直线就是实数的几何图像。数学中，实数的符号写成带双竖线的 R。</p><p>Complex numbers take the form a + bi, where i is the square root of minus 1. Numbers that take on this form are complex numbers, and they are opposed to real numbers.</p><p>复数的形式是 a + bi，其中 i 是 -1 的平方根。具有这种形式的数称为复数，与实数相对。</p><p>S: What is i? What type of number is that?</p><p>S（中文）：i 是什么？它是什么类型的数？</p><p>T: I is an imaginary number and so a complex number can be seen as adding up a real and an imaginary number</p><p>T（中文）：i 是虚数，所以复数可以看作一个实数与一个虚数之和。</p><p>So if the real numbers represent one dimension, what represents two dimensions? Well, you have to have an X from R and you have to have a Y from R.</p><p>如果实数代表一维，那么什么代表二维呢？你必须有一个来自 R 的 X 和一个来自 R 的 Y。</p><p>S: So how does this work for two-dimensional and three-dimensional spaces? How can they be written formally?</p><p>S（中文）：那二维和三维空间又是如何形式化表示的呢？</p><table><tr><td><table><tr><td><p><strong>ℝ</strong></p></td><td><p><strong>= 1  dimensional space, described by 1 variable, x</strong></p></td></tr><tr><td><p>ℝ²</p></td><td><p>=  2  dimensional space, described by 2 variables, x, y</p></td></tr><tr><td><p>ℝ³</p></td><td><p>=  3  dimensional space, described by 3 variables, x, y, z</p></td></tr><tr><td><p>ℝⁿ</p></td><td><p>=  n  dimensional space, described by n variables, n1 , n2 , n3 etc.</p></td></tr></table><p><em>Exhibit 1.14  State Spaces of Increasing Dimension (ℝ, ℝ², ℝ³, ℝⁿ)</em></p><p><em>展品 1.14  维度递增的状态空间（ℝ、ℝ²、ℝ³、ℝⁿ）</em></p></td></tr></table><p>T: The set of all such pairs X Y, with X in R and Y in R, has a name. It's called R cross R, or R squared, or R².  R² is the set of all pairs such that X is in R and Y is in R. The name for this, named by Descartes, is the Cartesian product of R. R³ is R cross R cross R, which is the set of all triples X Y Z where X is in R, Y is in R and Z is in R. This is called the Cartesian product of three copies of R. Descartes was the person who said that the space R cross R of real numbers X Y is identical to the two-dimensional geometric space X Y. A point (x₀, y₀) becomes a point in X-Y space.</p><p>T（中文）：所有这样的数对 X Y 组成的集合，其中 X 属于 R、Y 属于 R，有一个名字。它叫做 R 叉 R，或 R 的平方，或 R²。R² 是所有满足 X 属于 R、Y 属于 R 的数对组成的集合。这个名字由笛卡尔命名，称为 R 的笛卡尔积。R³ 是 R 叉 R 叉 R，即所有三元组 X Y Z 的集合，其中 X、Y、Z 都属于 R。这称为三个 R 的笛卡尔积。笛卡尔认为，由实数 X Y 组成的空间 R 叉 R 与二维几何空间 X Y 是同一的。点 (x₀, y₀) 成为 X–Y 空间中的一个点。</p><p>S: So from what I am understanding, we have an abstract space, and not a physical space?</p><p>S（中文）：所以我理解的是，我们有一个抽象空间，而不是物理空间？</p><p>T: Yes, that is the case here. Every time we talk about a space whose axes are not longitude and latitude on the earth, then we are talking about a Riemann space—an abstract space of a doubly extended quantity or a triply extended quantity. The whole idea of abstract n-dimensional space is due to Riemann, and we are using it very heavily.</p><p>T（中文）：是的，正是如此。每当我们谈论一个轴不是地球经纬度的空间时，我们谈论的就是黎曼空间——一种双重延伸或三重延伸的抽象空间。整个 n 维抽象空间的概念归功于黎曼，我们在课程中会大量用到它。</p>",
              "nodes": []
            },
            {
              "id": "modeling-life-l1-text-5",
              "title": "Vectors and Trajectories Change in State Space, Time Series Translation",
              "type": "text",
              "mode": "lecture",
              "exhibitMode": "authored",
              "html": "<p><strong>1.5 Vectors and Trajectories Change in State Space, Time Series Translation</strong></p><p><strong>1.5 向量与轨迹：状态空间中的变化，时序转换</strong></p><p>S: Over time, will we see that the system actually moves within the space due to the changes within the variables of the system?</p><p>S（中文）：随着时间推移，我们会看到系统由于内部变量的变化而在空间中移动吗？</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-1-image10.png\" /></p><p><em>Exhibit 1.15  Change of state on a one-dimensional temperature axis: the state point moves from T₁ (at t₁) to T₂ (at t₂)</em></p><p><em>展品 1.15  一维温度轴上的状态变化：状态点从 T₁（时刻 t₁）移动到 T₂（时刻 t₂）</em></p></td></tr></table><p>T: Yes, it will. Over time, the system will move from point to point. Let's call this x1 at time t1, and then there is x2 at time t2 later on. It's going to be at another point. Later on, it's going to be at another point. Descriptively, change can be seen as a trajectory through state space.</p><p>T（中文）：是的，会这样。随着时间推移，系统会从一点移动到另一点。假设在时刻 t1 它是 x1，之后在时刻 t2 它是 x2。它会在另一个点上。再往后，它还会到另一点。从描述上看，变化可以看作穿过状态空间的一条轨迹。</p><p>S: Can you give an example of what a trajectory means in practice?</p><p>S（中文）：你能举一个实际中轨迹是什么意思的例子吗？</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-1-image11.png\" /></p><p><em>Exhibit 1.16  The Romeo–Juliet plane with states (L, L), (H, H) and (H, L): positive is love, negative is hate</em></p><p><em>展品 1.16  罗密欧–朱丽叶平面：状态 (L, L)、(H, H) 与 (H, L)，正值表示爱，负值表示恨</em></p></td></tr></table><p>T: First of all, let's take one of our Romeo and Juliet examples. So here's Juliet's love for Romeo, here's Romeo's love for Juliet. R equals Romeo's love for Juliet, again as always at time T. And J equals Juliet's love for Romeo, again at time T.</p><p>T（中文）：首先，我们拿一个罗密欧与朱丽叶的例子。这是朱丽叶对罗密欧的爱，这是罗密欧对朱丽叶的爱。R 等于罗密欧对朱丽叶的爱，同样总是在时刻 T。J 等于朱丽叶对罗密欧的爱，同样也是在时刻 T。</p><p>S: In this case, I am guessing we will be taking positive as love and negative as hate?</p><p>S（中文）：在这种情况下，我猜我们把正值当作爱，负值当作恨？</p><p>T: Yes, let's suppose that at one point, this couple was at this point. So remember, in the Romeo and Juliet example, positive values denote love, negative values denote hate. So we can label this point. We know what this is: this is a point L, L—Juliet loves Romeo because the J value is positive, and Romeo loves Juliet because the R value is positive.</p><p>T（中文）：是的，假设在某个时刻，这对情侣处于这一点。记住，在罗密欧与朱丽叶的例子中，正值表示爱，负值表示恨。所以我们可以标记这个点。我们知道它意味着什么：这是 L、L 点——朱丽叶爱罗密欧，因为 J 值是正的；罗密欧爱朱丽叶，因为 R 值也是正的。</p><p>S: So if the point changes, does that mean the relationship changes too?</p><p>S（中文）：所以如果点发生变化，是不是意味着关系也变了？</p><p>T: Yes, over time, the couple will move in the trajectory shown in the graph. As we know, when someone becomes more positive, it means that person’s love is growing and when it becomes more negative the hate becomes stronger. The relationship between the two people will depend on how it moves.</p><p>T（中文）：是的，随着时间推移，这对情侣会沿着图中显示的轨迹移动。我们知道，当某个值变得更正时，意味着那个人的爱在增长；当它变得更负时，恨意更强。两人关系如何发展取决于它如何移动。</p><p>S: What does the next point mean if one value changes sign?</p><p>S（中文）：如果一个值变号，下一个点意味着什么？</p><p>T: The J value is still positive, but the R value is now negative. So we are in a \"Juliet loves Romeo but Romeo hates Juliet\" situation. Maybe further on, the system continues to evolve, and it evolves to this point. And what does that point mean? It means J is negative and R is negative. And so we are now in \"hate-hate\"—they each hate each other. Where the trajectory will go through now in the model will depend on the dynamics of the inter-relation between these couples. This is just a simple example of the idea that change is a trajectory through state space.</p><p>T（中文）：J 值仍然是正的，但 R 值现在变成负的了。于是我们处于“朱丽叶爱罗密欧，但罗密欧恨朱丽叶”的情形。再往后，系统继续演化，到达这一点。那个点意味着什么？意味着 J 是负的，R 也是负的。于是我们进入“恨–恨”状态——彼此憎恨。模型中轨迹接下来会走向何方，取决于这对情侣之间相互作用的动态。这只是“变化是穿过状态空间的轨迹”这一思想的一个简单例子。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-1-image12.png\" /></p><p><em>Exhibit 1.17  Oscillations in the populations of sharks and tuna over time</em></p><p><em>展品 1.17  鲨鱼与金枪鱼种群随时间的振荡</em></p></td></tr></table><p>In the shark-tuna system, this will be what it looks like:</p><p>在鲨鱼–金枪鱼系统中，它看起来会是这样：</p><p>The time series of the sharks and tunas on the right. From the starting point that has been shown, S has been decreasing throughout and it will stay low for a while. In the region where S is low, it will stay low for quite a while until S starts to increase again. S starts to increase again until it comes back to the green dot at the end and completes this excursion.</p><p>右侧是鲨鱼和金枪鱼的时序图。从所示的起点出发，S 一直在下降，并会保持低位一段时间。在 S 很低的区域，它会保持相当长时间的低位，直到 S 再次开始增长。S 再次增长，直到最后回到绿色的终点，完成这一循环。</p><p>S: Why does the tuna population stay low when the shark population is changing?</p><p>S（中文）：为什么鲨鱼种群在变化时，金枪鱼种群会保持低位？</p><p>T: Well, at some initial point, you'll notice that T was at its minimum value. T is as low as it is ever going to be. And so let's have T at a minimum value here at that same starting point. And then what happens to T is pretty much nothing during the whole part at the start. While the state point is going to the left, T is staying at its low value. And T does not start to rise until S has hit its minimum. So at the minimum of S here, we're going to have T start to rise. And then T continues to rise all the time while S is still very low. T rises, and then when T is at its maximum, T begins to decline and S begins to increase. And so we get a curve that looks like that.</p><p>T（中文）：在某个初始点，你会注意到 T 处于最小值。T 低到它再也不会更低的程度。所以在那个起点处，T 取最小值。然后，在开始时整个阶段中，T 的变化基本不大。当状态点向左移动时，T 保持在低水平。直到 S 达到最小值，T 才开始上升。所以在 S 的这个最小值处，T 开始上升。然后，在 S 仍然很低的时候，T 持续上升。T 上升，当 T 达到最大值时，T 开始下降，S 开始增加。于是我们得到这样一条曲线。</p><p>S: That helps me understand it better now. So what should be my key takeaways from today’s lecture?</p><p>S（中文）：这样我就更明白了。那么我今天这节课的关键要点应该是什么？</p><table><tr><td><p><strong>Key Concepts</strong></p><p>A system can be thought of as a collection of states at different times</p><p>These states can be mathematically represented by vectors</p><p>Vectors can be added together and multiplied by scalars</p><p>The dynamics of a system can be mathematically represented as the trajectory through the vectors describing its states at different times.</p><p><em>Exhibit 1.18  Key Concepts</em></p><p><em>展品 1.18  关键概念</em></p></td></tr></table><p>T: The first key concept is the concept of the state vector. Think of a system as a collection of states over time. Think of a vector as the mathematical description of those states. The state vector X, Y, Z corresponds to a point in state space. Since the vector is a tuple, X,Y,Z, this is a point 3 dimensional state space. This means that this system is described by the interaction of three variables, e.g. sharks, tuna and plankton.</p><p>T（中文）：第一个关键概念是状态向量。状态向量 X、Y、Z 对应状态空间中的一个点，这一点已经在三维状态空间中展示过了。</p><p>The second piece of machinery we talked about was adding vectors and multiplying a vector by a scalar. And we saw what that means geometrically. It means taking the two vectors and just adding them tip-to-tail. And then the resultant vector here is the vector X1 + X2—or rather, (X1, Y1) + (X2, Y2) is the resultant red vector. And when we multiply a vector by a scalar, that amounts to taking that vector and either stretching it or shrinking it, depending upon whether a is bigger than one or not, in the same direction.</p><p>第二个要点是：我们讨论了向量相加以及向量与标量相乘。我们看到了这在几何上意味着什么。它意味着把两个向量首尾相接相加，然后这里的合向量就是 X1 + X2——更确切地说，(X1, Y1) + (X2, Y2) 就是红色的合向量。当我们用标量乘一个向量时，相当于把这个向量拉长或缩短，取决于 a 是否大于 1，方向保持不变。</p><p>Finally, the third idea we developed was change being a trajectory through the state space.</p><p>最后，我们建立的第三个结构是：变化是穿过状态空间的一条轨迹。</p>",
              "nodes": []
            },
            {
              "id": "modeling-life-l1-video-1",
              "title": "State Variables and State Spaces",
              "type": "video",
              "mode": "lecture",
              "url": "/api/course-media/modeling-life/04f0039b-42c7-441b-85b7-fe6e21c6bbe6",
              "startSeconds": 10,
              "exhibitMode": "authored",
              "nodes": [
                {
                  "id": "modeling-life-l1-exhibit-1",
                  "title": "T, W, V, C",
                  "type": "image",
                  "url": "/api/course-media/modeling-life/9a88e350-e44f-47b1-9518-ed8b50cc4d36",
                  "thumbnail": "/api/course-media/modeling-life/1b00006f-08ed-4f77-8285-a4685e3237de",
                  "description": "A cup of coffee described by four state variables (T, W, V, C): temperature = 63.1 °C, weight = 128 g, volume = 470 ml, caffeine concentration = 20 mg/oz",
                  "source": "-",
                  "triggerTime": 37
                },
                {
                  "id": "modeling-life-l1-exhibit-2",
                  "title": "Three examples of one-dimensional state spaces",
                  "type": "image",
                  "url": "/api/course-media/modeling-life/3d1a37f4-6535-450c-879a-22c3cad48b08",
                  "thumbnail": "/api/course-media/modeling-life/1d1e5a63-48ef-47b9-aeaf-b4a41b065515",
                  "description": "Three examples of one-dimensional state spaces: voltage, population size, and the fraction of a wolf population that has black fur",
                  "source": "-",
                  "triggerTime": 160
                }
              ]
            },
            {
              "id": "modeling-life-l1-video-2",
              "title": "Defining Vectors",
              "type": "video",
              "mode": "lecture",
              "url": "/api/course-media/modeling-life/04f0039b-42c7-441b-85b7-fe6e21c6bbe6",
              "startSeconds": 412,
              "exhibitMode": "authored",
              "nodes": []
            },
            {
              "id": "modeling-life-l1-video-3",
              "title": "State Space Rules for Operating with Vectors",
              "type": "video",
              "mode": "lecture",
              "url": "/api/course-media/modeling-life/04f0039b-42c7-441b-85b7-fe6e21c6bbe6",
              "startSeconds": 587,
              "exhibitMode": "authored",
              "nodes": []
            },
            {
              "id": "modeling-life-l1-video-4",
              "title": "Vectors And Vector Spaces",
              "type": "video",
              "mode": "lecture",
              "url": "/api/course-media/modeling-life/04f0039b-42c7-441b-85b7-fe6e21c6bbe6",
              "startSeconds": 1026,
              "exhibitMode": "authored",
              "nodes": []
            },
            {
              "id": "modeling-life-l1-video-5",
              "title": "Vectors and Trajectories Change in State Space, Time Series Translation",
              "type": "video",
              "mode": "lecture",
              "url": "/api/course-media/modeling-life/04f0039b-42c7-441b-85b7-fe6e21c6bbe6",
              "startSeconds": 1175,
              "exhibitMode": "authored",
              "nodes": []
            }
          ],
          "assessments": {
            "knowledge": [
              {
                "id": "modeling-life-l1-knowledge-1",
                "prompt": "What is the conceptual model of how science approaches the study of any dynamic system?",
                "referenceAnswer": "It is the mathematical framework of state spaces, vector spaces and trajectories."
              },
              {
                "id": "modeling-life-l1-knowledge-2",
                "prompt": "What is a state?",
                "referenceAnswer": "A state is the aspect of a phenomenon that we are investigating. For example, suppose the phenomenon we are interested in is a cup of coffee, then the state might be its location in the room, the amount of coffee in the cup or the temperature of the coffee."
              },
              {
                "id": "modeling-life-l1-knowledge-3",
                "prompt": "What determines the choice of state?",
                "referenceAnswer": "That is determined by what change we are interested in understanding. If we are interested in how fast the coffee is evaporating, then we might focus on the volume or weight of coffee in the cup over time rather than where the cup is in the room or the temperature of the coffee in the cup."
              },
              {
                "id": "modeling-life-l1-knowledge-4",
                "prompt": "Why do states always have numbers and units attached?",
                "referenceAnswer": "If we are going to use mathematics to describe a system, then the states need to be quantified in terms of a recognised measurement unit. So for example, the weight might be measured in grams or the temperature in degrees Kelvin."
              },
              {
                "id": "modeling-life-l1-knowledge-5",
                "prompt": "Does this same modelling approach apply only to the phenomena studied by physics or chemistry?",
                "referenceAnswer": "It also applies outside the material sciences, for example in areas studied by economics or biology. It can be used to model an animal population over time and in this case the state will be the size of the population, i.e. the number of animals in the population."
              },
              {
                "id": "modeling-life-l1-knowledge-6",
                "prompt": "What’s a state variable?",
                "referenceAnswer": "A variable is the measured value of the state of a system. For example, temperature is often recorded in degrees Kelvin."
              },
              {
                "id": "modeling-life-l1-knowledge-7",
                "prompt": "What is a state space?",
                "referenceAnswer": "A  state space is all the possible states a system can be in over time."
              },
              {
                "id": "modeling-life-l1-knowledge-8",
                "prompt": "What sort of system is described by more than one state variable?",
                "referenceAnswer": "Sometimes a system’s changes depend on the interaction of different factors, so it takes more than one variable to describe it. Take the example of an animal population where there is a predator-prey relationship, such as sharks and tuna. The shark-tuna population is described by two variables, the number of sharks and the number of tuna at any one time."
              },
              {
                "id": "modeling-life-l1-knowledge-9",
                "prompt": "Is the shark-tuna space something different from the ocean, where sharks and tuna live?",
                "referenceAnswer": "Yes, they are very different. For one thing, shark-tuna space is two-dimensional, and real life is three-dimensional. But more importantly, shark-tuna space is populated not by real sharks and real tuna, but by numbers, representing the size of the shark and tuna populations at some time."
              },
              {
                "id": "modeling-life-l1-knowledge-10",
                "prompt": "Can state spaces be more than three- dimensional?",
                "referenceAnswer": "Yes, they can. For example, the model of a neuron typically has four variables in its description."
              },
              {
                "id": "modeling-life-l1-knowledge-11",
                "prompt": "What is a vector?",
                "referenceAnswer": "A vector is a way of describing a location in state space in relation to the point of origin in the state space. A vector therefore has two attributes: magnitude and direction."
              },
              {
                "id": "modeling-life-l1-knowledge-12",
                "prompt": "How do we manipulate vectors mathematically?",
                "referenceAnswer": "There are two ways of doing this: addition and multiplication."
              },
              {
                "id": "modeling-life-l1-knowledge-13",
                "prompt": "How do you add vectors?",
                "referenceAnswer": "You can add vectors together by adding their numerical values, matching dimension with dimension."
              },
              {
                "id": "modeling-life-l1-knowledge-14",
                "prompt": "Can I add a one-dimensional vector to a two-dimensional vector?",
                "referenceAnswer": "No, two vectors can only be added if they are the same dimensional size."
              },
              {
                "id": "modeling-life-l1-knowledge-15",
                "prompt": "How does multiplication work in vectors?",
                "referenceAnswer": "Multiplication works by scaling up or scaling down all the elements of a vector. So suppose we want to increase the size of a vector V1 by 3 and the vector is two-dimensional (x1, y1), then 3V1 = ( 3x1, 3y1). This multiplication factor is called a scalar."
              },
              {
                "id": "modeling-life-l1-knowledge-16",
                "prompt": "Can you multiply vectors together?",
                "referenceAnswer": "That is possible, but there are different rules for doing that, depending on what you are trying to find out. In our example of the shark-tuna space, it’s not clear what multiplying one data point by another might mean, so multiplying in this case doesn’t make sense."
              },
              {
                "id": "modeling-life-l1-knowledge-17",
                "prompt": "What if the scalar is less than 1 or a negative number?",
                "referenceAnswer": "When we multiply by a number less than 1, we reduce the magnitude of a vector. If the scalar is 0.5, then the resulting vector is half the size of the original vector. When we multiply by a negative number, it changes the direction of a vector. So when the scalar is -1, the magnitude of the vector is unchanged, but the direction is reversed."
              },
              {
                "id": "modeling-life-l1-knowledge-18",
                "prompt": "What are trajectories?",
                "referenceAnswer": "The changes to a system can be thought of as the trajectory or path followed from one state space location to another, those locations being described by vectors."
              }
            ],
            "application": {
              "id": "modeling-life-l1-application",
              "paragraphs": [
                "Suppose an animal population has two genotypes: black hawks and white doves.  They continually compete for the same food source.",
                "Hawks always fight when they meet other birds. Doves never fight. They either let hawks eat all the food or share the food with another dove.",
                "If a hawk competes with another hawk for food, its survival rate decreases by a factor of 3 when it fights and loses and increases by 2 if it wins. It has a 50% chance of winning. If it competes with a dove, it always increases its survival rate by 2 , since the dove doesn’t fight. A dove’s survival rate is unchanged if it meets a hawk. If it meets another dove, the food would increase its survival rate by the same value of 2, but it shares the food equally with the other dove.",
                "What mixed population of hawks and doves will be a stable equilibrium?"
              ],
              "reference": [
                "Mathematically, this sounds like a problem to find the equilibrium points of a differential equation with two variables. And specifically in biology this seems like a straightforward ecological system without any constraints on upper or lower limits where two genotypes interact. That calls for a game theoretic approach and the place to start is the payoff matrix for the hawk and dove encounters.",
                "Let’s start with the Hawks. When a Hawk meets a Hawk, then 50% of the time the first hawk wins (+2), and 50% of the time it loses (-3). So expected payoff = (0.5 * 2) + (0.5*-3) = -0.5. If a Hawk meets a Dove, then that’s always +2, so payoff is +2. If a Dove meets a Hawk, it never competes for food, so there is no impact on survival, and payoff is 0. If a Dove meets another Dove, then the food (+2) is shared, so payoff is (0.5 * 2) = 1.",
                "This gives the following payoff matrix:",
                "\tHawk\tDove",
                "Hawk\t-0.5\t2",
                "Dove \t     0\t1",
                "Now for the differential equation that describes how the composition of a two genotype population changes depending on the fitness of the population genotypes:",
                " dX/dT = ( f(a) – f(b))*X*(1-X).",
                "This is the replicator formula. In other words, the change in one genotypes’s proportion of a population over time (dX/dT) is calculated using two functions: the difference between that genotype’s fitness and the other genotype’s fitness (f (a) – f(b)) and the frequency with which that genotype competes with the other genotype, calculated as the product of their respective proportions of the total population. If one genotype’s proportion of the population is ¼, then the other genotype’s proportion is 1 – ¼, i.e. ¾.    ",
                "An equilibrium point is reached when dX/dT = 0. Mathematically, an equilibrium is reached when the population is all Hawks or all Doves, i.e. if X means the Hawk proportion of the population, when 1 – X = 0 or X= 0. But the question asks us to find an equilibrium that is a mixed population of Hawks and Doves. ",
                "To find that equilibrium, we need to expand the expression (f(a) – f(b)) and solve for where (f(a) – f(b)) = 0. We can expand this expression by going back to the payoff matrix and adding in frequency information. Assume again that X is the proportion of Hawks in a population.  Then the Hawk’s fitness will be:",
                "(-0.5 (payoff or fitness) * X (proportion of Hawks and frequency of meeting a Hawk) +",
                "(2 (payoff or fitness) * (1 – X) (proportion of Doves and frequency of meeting a Dove)",
                "= -0.5X + 2(1 – X)",
                "= 2 – 2.5X",
                "Similarly for Doves:         ",
                "( 0 (payoff or fitness) * X (proportion of Hawks and frequency of meeting a Hawk) +",
                "(1 (payoff or fitness) * (1 – X) (proportion of Doves and frequency of meeting a Dove)",
                "= 0 + ( 1  – X)",
                "= 1 –  X.",
                "So the mixed equilibrium point will be where:",
                " 2 – 2.5 X = 1 – X",
                " 1 – 1.5X = 0",
                " 2/3 = X. ",
                "So the Hawk population, as the fitter genotype, is ⅔ of the population and the Doves are therefore ⅓."
              ]
            }
          },
          "exploration": {
            "readings": [
              {
                "id": "modeling-life-l1-reading-1",
                "kind": "book",
                "title": "Garfinkel, Shevtsov, Guo: Modeling Life, pp 16 – 23.",
                "author": "",
                "description": "",
                "lessonNumber": "01"
              },
              {
                "id": "modeling-life-l1-reading-2",
                "kind": "article",
                "title": "MIT Open Courseware, Feeedback and Control Systems, State Space: Linear Systems, lectures 9-13.",
                "author": "",
                "description": "",
                "lessonNumber": "01"
              },
              {
                "id": "modeling-life-l1-reading-3",
                "kind": "article",
                "title": "Wikipedia, State Space Representation.",
                "author": "",
                "description": "",
                "lessonNumber": "01"
              }
            ],
            "exhibits": [
              {
                "node": {
                  "id": "modeling-life-exhibit-1-2",
                  "title": "T, W, V, C",
                  "type": "image",
                  "url": "/api/course-media/modeling-life/9a88e350-e44f-47b1-9518-ed8b50cc4d36",
                  "thumbnail": "/api/course-media/modeling-life/1b00006f-08ed-4f77-8285-a4685e3237de",
                  "description": "A cup of coffee described by four state variables (T, W, V, C): temperature = 63.1 °C, weight = 128 g, volume = 470 ml, caffeine concentration = 20 mg/oz",
                  "source": "-",
                  "triggerTime": 37,
                  "active": true
                },
                "lessonNumber": "01",
                "thumbnail": "/api/course-media/modeling-life/1b00006f-08ed-4f77-8285-a4685e3237de"
              },
              {
                "node": {
                  "id": "modeling-life-exhibit-1-4",
                  "title": "Three examples of one-dimensional state spaces",
                  "type": "image",
                  "url": "/api/course-media/modeling-life/3d1a37f4-6535-450c-879a-22c3cad48b08",
                  "thumbnail": "/api/course-media/modeling-life/1d1e5a63-48ef-47b9-aeaf-b4a41b065515",
                  "description": "Three examples of one-dimensional state spaces: voltage, population size, and the fraction of a wolf population that has black fur",
                  "source": "-",
                  "triggerTime": 160,
                  "active": true
                },
                "lessonNumber": "01",
                "thumbnail": "/api/course-media/modeling-life/1d1e5a63-48ef-47b9-aeaf-b4a41b065515"
              }
            ]
          }
        },
        {
          "id": "modeling-life-lesson-2",
          "title": "Pitchfork Bifurcation",
          "summary": "A new model and a new kind of bifurcation.",
          "body": "",
          "durationMinutes": 27,
          "videoDurationSeconds": 1584,
          "isPublic": false,
          "preview": {
            "textPointCount": 0,
            "videoLimitSeconds": 600
          },
          "contents": [
            {
              "id": "modeling-life-l2-text-1",
              "title": "Pitchfork Bifurcation in a Model of Public Opinion",
              "type": "text",
              "mode": "lecture",
              "exhibitMode": "authored",
              "html": "<p><strong>Modelling Life</strong></p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image1.png\" /></p><p><em>Exhibit 2.1  Lesson cover image: the pitchfork bifurcation (solid = stable, dashed = unstable)</em></p><p><em>展品 2.1  本课封面图：叉式分岔（实线为稳定，虚线为不稳定）</em></p></td></tr></table><p><strong>2.1 Pitchfork Bifurcation in a Model of Public Opinion</strong></p><p><strong>2.1 舆论模型中的叉式分岔</strong></p><p>T: Now I want to talk about a new model and a new kind of bifurcation. So I’m continuing with the topic of bifurcations, and this is an interesting new kind. I am going to follow a paper by Thomas Lux, which is in the Economic Journal in 1995, called \"Market Bubbles and Crashes.\" And this is about financial markets and the question of how do bubbles and market crashes happen.</p><p>T（中文）：现在我想讲一个新模型和一种新类型的分岔。我们继续讨论分岔这个主题，这是一种有意思的新类型。我将沿着 Thomas Lux 1995 年发表在《Economic Journal》（经济学杂志）上的论文《Market Bubbles and Crashes》（市场泡沫与崩盘）来展开。它关注的是金融市场，以及泡沫和市场崩盘是如何产生的这个问题。</p><p>Here we have a compartmental model. And in a compartmental model, the assumption is that the system dynamic is best understood by grouping the data points into separate boxes. And for this particular model, we're going to have two compartments. Lux was interested in modeling stock market crashes and bubbles and the two kinds of compartments he identified were bears and bulls: people who think the stock market is going down and people who think the stock market is going up. But a compartmental model could contain any sort of negative-positive, exclusive grouping of data points; it could be anything. It could be opposing political parties, such as left wing and right wing; it could be whatever.</p><p>这里我们有一个仓室模型。在仓室模型中，基本假设是：把数据点分进不同的盒子里，系统的动力学才能得到最好的理解。对这个具体的模型，我们设两个仓室。Lux 想对股市崩盘和泡沫建模，他识别出的两类仓室是“空头”和“多头”：认为股市会下跌的人和认为股市会上涨的人。但仓室模型可以包含任何互斥的“负–正”式数据点分组；它可以是任何东西，可以是对立的政治党派，比如左翼和右翼，随便什么都可以。</p><p>S: So a compartmentalised model reflects the fact that there are competing elements or forces that are behind the change being investigated?</p><p>S（中文）：所以仓室模型反映的是：在被研究的变化背后，存在着相互竞争的元素或力量？</p><table><tr><td><p><img alt=\"截屏2026-10-09 18.05.30\" src=\"/courses/modeling-life/lesson-2-image2.png\" /></p><p><em>Exhibit 2.2  The two compartments of the model: the N compartment and the P compartment with the four transition arrows</em></p><p><em>展品 2.2  模型的两个仓室：N 仓室与 P 仓室，以及四条转移箭头</em></p></td></tr></table><p>T: Correct. In a compartmental model, we start by writing down the compartments. In ours there are two compartments: this is the N compartment and the P compartment. And then we ask the usual questions: what adds to the N compartment? What detracts from the N compartment? What adds to the P compartment? What detracts from the P compartment?</p><p>T（中文）：没错。在仓室模型里，我们先把仓室写下来。我们这个模型里有两个仓室：这是 N 仓室和 P 仓室。然后我们问通常的问题：什么使 N 仓室增加？什么使 N 仓室减少？什么使 P 仓室增加？什么使 P 仓室减少？</p><p>S: What are the four arrows that we see in the picture?</p><p>S（中文）：图中的四个箭头是什么？</p><p>T: In an economic model, these four arrows would typically be births and deaths, or immigration and emigration. This would be death and/or emigration; birth and immigration, death and emigration—all of those are possible and would have to be in a complete model. But we're going to look at behaviour over a shorter-term period, so that basically no one dies. There is no death term in our model, and there is no birth term in our model. And the only thing changing is the movement between the two groups.The only changes that are going to occur in our model are the changes from N to P and the changes from P to N. So in that respect, it's a lot like a chemical reaction.</p><p>T（中文）：在经济模型中，这四个箭头通常会是出生和死亡，或者迁入和迁出。这个是死亡和/或迁出，那个是出生和迁入、死亡和迁出——都有可能，一个完整的模型里必须把它们都包含进来。但我们要考察的是较短时间段内的行为，所以基本上没有人死亡。我们的模型里没有死亡项，也没有出生项，唯一变化的是两个群体之间的流动。模型中唯一会发生的改变，就是从 N 到 P 的改变和从 P 到 N 的改变。从这个角度看，它很像化学反应。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image3.png\" /></p><p><em>Exhibit 2.3  The two-compartment diagram with transition rates: K_NP from N to P, K_PN from P to N</em></p><p><em>展品 2.3  两仓室图与转移速率：K_NP（从 N 到 P）、K_PN（从 P 到 N）</em></p></td></tr></table><p>So we have people going from N to P, and we're going to call the rate of that K sub N to P. And then we have people going from P to N, and that rate is going to be K sub P to N.</p><p>于是我们有从 N 流向 P 的人，其速率我们称为 K_NP（K sub N to P）；也有从 P 流向 N 的人，该速率就是 K_PN（K sub P to N）。</p><p>S: Are these the transition rates between the two opinions, those who are positive about the stock market and those who are negative?</p><p>S（中文）：这些就是两种观点之间的转移速率吗——也就是对股市乐观的人群与悲观的人群之间的转移速率？</p><p>T: Yes they are.</p><p>T（中文）：是的。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image4.png\" /></p><p><em>Exhibit 2.4  The differential equations for the two compartments: P′ = k_NP·N − k_PN·P and N′ = −k_NP·N + k_PN·P</em></p><p><em>展品 2.4  两个仓室的微分方程：P′ = k_NP·N − k_PN·P，N′ = −k_NP·N + k_PN·P</em></p></td></tr></table><p>So from this compartmental diagram, we can write the differential equation: N-prime equals what makes N go up, minus what makes N go down. What makes N go up is Ps converting to Ns at a rate K sub P to N times P. So N-prime equals K sub P to N times P. That's the Ps converting to Ns. But then, what detracts from N? What makes N go down? Ns converting to Ps is just K sub N to P times N. Similarly, P-prime is just going to be the opposite. P-prime: the positive term is K sub N to P times N, and that's the Ns converting to Ps. The negative term is the P's converting to Ns, which is K sub P to N times P. So there is a nice differential equation in the two variables N and P.</p><p>从这个仓室图，我们可以写出微分方程：N′（N-prime）等于让 N 上升的部分，减去让 N 下降的部分。让 N 上升的是 P 以速率 K_PN × P 转化为 N，所以 N′ = K_PN × P，这就是 P 转化为 N 的部分。那么什么让 N 减少？N 转化为 P 就是 K_NP × N。类似地，P′ 就是反过来：P′ 的正项是 K_NP × N，即 N 转化为 P；负项是 P 转化为 N，即 K_PN × P。这样就得到一个关于 N 和 P 两个变量的漂亮的微分方程。</p><p>S: Are the rates that we have constant?</p><p>S（中文）：我们已有的这些速率是常数吗？</p><p>T: Yes they are but we haven't specified what these constants are. In fact, they're not going to be constant. But what these transition probabilities are is a way to think about K sub P to N and K sub N to P. These are the transition probabilities or the transition rates from N to P and from P to N.</p><p>T（中文）：是的，但我们还没有说明这些常数是什么。实际上它们不会是常数。不过，可以把这些转移概率当作理解 K_PN 和 K_NP 的一个思路：它们就是从 N 到 P、从 P 到 N 的转移概率，或者叫转移速率。</p><p>But you'll notice something: if there's no birth and no death, then the total population is constant. And that means that the total population is N plus P. And we're saying that N plus P is a constant. And for reasons that will become clear in a minute, we’re going to define that constant as 2m. So 2m is the number of people.</p><p>但你会注意到一件事：如果没有出生也没有死亡，那么总人口是恒定的。这意味着总人口就是 N 加 P，而我们说 N + P 是一个常数。出于稍后就会清楚的原因，我们把这个常数定义为 2m。所以 2m 就是人数。</p><p>S: Why are we defining it as 2m?</p><p>S（中文）：为什么要把它定义为 2m？</p><p>T: It’s because we want to use this to convert this two-variable differential equation into a single-variable differential equation. We love single-variable differential equations, because we can study them with very special methods.</p><p>T（中文）：因为我们想用它把这个双变量微分方程转换成单变量微分方程。我们偏爱单变量微分方程，因为可以用非常特别的方法来研究它们。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image5.png\" /></p><p><em>Exhibit 2.5  The state variable X = (P − N) / 2m: the net balance of positive (P) over negative (N) sentiment as a proportion of total sentiment</em></p><p><em>展品 2.5  状态变量 X = (P − N) / 2m：正情绪（P）对负情绪（N）的净差额占总情绪的比例</em></p></td></tr></table><p>So how are we going to convert this to one variable? We’re going to define a single variable. And the variable we’re going to define is X. We’re going to define it as: X = (P - N) / 2m</p><p>那么我们怎么把它转换成一个变量呢？我们要定义一个单一变量，要定义的变量就是 X。定义如下：X = (P - N) / 2m</p><p>S: But what does X actually mean ?</p><p>S（中文）：可是 X 到底是什么意思？</p><p>T: Well it is the imbalance of positives over negatives. So we're going to call this the imbalance toward positivity. X measures whether the crowd leans positive or negative. Notice that if P equals N, that we have an equal number of positives and negatives. And in that case, when P equals N, X equals 0. So X can be negative if the negatives outweigh the positives, or X can be positive if the positives outweigh the negatives. So that is our new variable.</p><p>T（中文）：它是正方对负方的失衡度，所以我们把它叫做“趋向正向的失衡度”。X 衡量人群整体偏向乐观还是悲观。注意，如果 P 等于 N，即正方和负方数量相等，那么 X 就等于 0。所以，如果负方多于正方，X 可以为负；如果正方多于负方，X 可以为正。这就是我们的新变量。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image6.png\" /></p><p><em>Exhibit 2.6  Converting the two-variable equation into a single-variable equation: X′ = (1/2m)(P′ − N′) = (1/m)(k_NP·N − k_PN·P)</em></p><p><em>展品 2.6  把双变量方程化为单变量方程：X′ = (1/2m)(P′ − N′) = (1/m)(k_NP·N − k_PN·P)</em></p></td></tr></table><p>Now we need to use that new variable to convert this two-variable equation into a single-variable equation. So first of all, if X is equal to (P - N) / 2m, then we can just differentiate that expression and say: X-prime = (1 / 2m) × (P-prime - N-prime) Now we know what P-prime and N-prime are. Let's put them in: (1 / 2m) × [K sub N to P × N - K sub P to N × P - (K sub P to N × P - K sub N to P × N)]. So what have we got here? We have K sub N to P times N, plus K sub N to P times N. So let's just have a 2 there. And then we have minus K sub P to N times P, minus K sub P to N times P. Let's have minus 2 there and take that out also. Now we can get rid of that 2, and we have: X-prime = (1 / m) × [K sub N to P × N - K sub P to N × P].</p><p>现在我们要用这个新变量把双变量方程转换成单变量方程。首先，如果 X = (P - N) / 2m，那么可以直接对这个表达式求导：X′ = (1 / 2m) × (P′ - N′)。我们知道 P′ 和 N′ 是什么，代进去：(1 / 2m) × [K_NP × N - K_PN × P - (K_PN × P - K_NP × N)]。这里我们得到了什么？K_NP × N 加上 K_NP × N，所以那里有个 2；再减去 K_PN × P、减去 K_PN × P，那里也是个 -2。把这个 2 消掉，就得到：X′ = (1 / m) × [K_NP × N - K_PN × P]。</p><p>S: But even after doing all that we still have N and P in our equation?</p><p>S（中文）：可是经过这一番推导，方程里不还是有 N 和 P 吗？</p><p>T: Right so now we need to find out what K sub N to P and K sub P to N are, and then get N and P out of that equation in terms of X, which is what we will now do. So we're making progress in laying out this differential equation. So now we have the beginnings of a differential equation for X, but we still have a lot of non-X terms in there, and we have to get rid of them.</p><p>T（中文）：对，所以现在我们要弄清楚 K_NP 和 K_PN 是什么，然后把 N 和 P 用 X 表示、从方程里替换掉，这正是我们接下来要做的。我们在建立这条微分方程的路上不断取得进展：现在已经有了 X 的微分方程的雏形，但里面还有不少非 X 的项，必须把它们消掉。</p><p>S: What assumptions do we make about the transition rates?</p><p>S（中文）：那我们对这些转移速率做什么假设呢？</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image7.png\" /></p><p><em>Exhibit 2.7  Deriving the form of the transition rate K_NP: from “not constant” to K_NP = v·e^(aX), with K_PN = v·e^(−aX)</em></p><p><em>展品 2.7  推导转移速率 K_NP 的形式：从“不是常数”到 K_NP = v·e^(aX)，以及 K_PN = v·e^(−aX)</em></p></td></tr></table><p>T: Well what are we are going to say about K sub N to P and K sub P to N? First of all, they're not constants. K sub N to P is the transition probability or the transition frequency or the rate constant, if you will, transition from negative to positive is going to depend on the imbalance towards positive. We're going to assume here the shape of this function is going to be an increasing function of X.</p><p>T（中文）：那么，我们对 K_NP 和 K_PN 要说什么呢？首先，它们不是常数。K_NP 是转移概率，或者叫转移频率、速率常数——随你怎么叫——从负到正的转移将取决于趋向正向的失衡度。我们在这里假设这个函数的形状是 X 的增函数。</p><p>S: So the more positive the general mood, the more likely people are to switch to positive.</p><p>S（中文）：所以总体情绪越乐观，人们就越有可能转向乐观。</p><p>T: Yes. We're also going to assume that K sub N to P grows exponentially with X. And we're going to assume a model in which K sub N to P grows exponentially with X. We need to just put a constant in front of that, but that constant is going to drop out in a minute. So K sub N to P is an exponentially growing function of the imbalance towards positivity. This is often called the bandwagon effect.</p><p>T（中文）：是的。我们还假设 K_NP 随 X 指数增长，也就是采用 K_NP 随 X 指数增长的模型。它前面需要放一个常数，但这个常数很快就会被消掉。所以 K_NP 是“趋向正向失衡度”的指数增长函数。这通常被称为从众效应（bandwagon effect）。</p><p>The idea of the bandwagon effect is: the more people that are on the bandwagon, the more people want to join the bandwagon. And so it's a positive-feedback kind of term, which you see from the shape of the math. And this is postulating a bandwagon effect. And that parameter, a, is just going to be the strength of the bandwagon effect.</p><p>从众效应的含义是：加入的人越多，想加入的人就越多。所以这是一个正反馈式的项，从数学式的形状就能看出来。这就是对从众效应的假设。而参数 a 就是从众效应的强度。</p><p>S: What about the other direction?</p><p>S（中文）：那另一个方向呢？</p><p>T: Well conversely, we need a K sub P to N. And that's going to be the transition from positive to negative. That also needs to be a function of X, but it needs to be a declining function of X. And so we're going to assume e to the minus aX. And then we need a constant in there, where we're going to assume that K sub P to N is a negative bandwagon effect: that the more people are attracted, the fewer people will be transitioning from P to N.</p><p>T（中文）：相反地，我们还需要一个 K_PN，也就是从正到负的转移。它同样必须是 X 的函数，但得是 X 的减函数。于是我们假设它等于 e 的负 aX 次方（e^-aX）。里面还要放一个常数。我们假设 K_PN 是一个“负向的从众效应”：被吸引过去的人越多，从 P 转向 N 的人就越少。</p><p>S: So we will see that one rate rises and the other one falls then</p><p>S（中文）：所以我们将会看到一个速率上升、另一个速率下降。</p><p>T: Exactly. We now have K sub N to P and K sub P to N in terms of X and parameters. Now we just need to get N and P out of there. In order to get N and P in terms of X, we just need to do a little algebraic manipulation. To do that we need to think about why does one rate rise and the other fall with X?</p><p>T（中文）：正是如此。现在 K_NP 和 K_PN 都已经用 X 和参数表示了。接下来只需把 N 和 P 从方程里替换掉。为此只需要做一点代数运算。要做这件事，得先想一想：为什么一个速率随 X 上升，而另一个随 X 下降？</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image8.png\" /></p><p><em>Exhibit 2.8  Expressing N and P in terms of X: P = m(1 + X), N = m(1 − X), giving X′ = k_NP·(1 − X) − k_PN·(1 + X), then X′ = (1 − X)·v·e^(aX) − (1 + X)·v·e^(−aX)</em></p><p><em>展品 2.8  用 X 表示 N 与 P：P = m(1 + X)、N = m(1 − X)，得到 X′ = k_NP·(1 − X) − k_PN·(1 + X)，进而 X′ = (1 − X)·v·e^(aX) − (1 + X)·v·e^(−aX)</em></p></td></tr></table><p>So let's remember what X is. Remember the definition of X: it's (P - N) / 2m. So what is 1 plus X? 1 plus X is going to be 1—which we write in the form (P - N) / 2m, which is equal to (2m + P - N) / 2m. So we have 1 plus X is equal to (2m + P - N) / 2m.</p><p>我们来回忆一下 X 是什么。记住 X 的定义：X = (P - N) / 2m。那么 1 + X 是多少？1 + X 等于 1 加上 (P - N) / 2m，也就是 (2m + P - N) / 2m。所以我们有 1 + X = (2m + P - N) / 2m。</p><p>T: Well let's work on that a little bit. 2m is of course, by definition, N plus P. So now we have (N + P + P - N) / 2m. And the N's cancel, and that's 2P / 2m, or P / m. So now we're going to rewrite this equation a little bit. We’re going to pull that M into the equation and write it as: K sub N to P times (N / m) minus K sub P to N times (P / m). And that's X-prime.</p><p>T（中文）：我们来算一算。2m 按定义当然就是 N + P。于是得到 (N + P + P - N) / 2m。N 消掉了，就是 2P / 2m，即 P / m。现在我们把这个方程稍微改写一下：把 m 挪进式子里，写成 K_NP × (N / m) - K_PN × (P / m)。这就是 X′。</p><p>And now P / m. We know that that is 1 plus X. By the same style of argument, it's easy to show that 1 minus X is equal to 1 minus (P - N) / 2m. And that's going to be (2m - P - N) / 2m. And that, when we start substituting. This is going to be (P + N - P + N) is 2N / 2m. So that's N / m is equal to 1 minus X. And now we can substitute all of those in there.</p><p>再看 P / m。我们知道它等于 1 + X。用同样风格的论证，容易证明 1 - X = 1 - (P - N) / 2m，也就是 (2m - P - N) / 2m。开始代入之后，它就是 (P + N - P + N)，即 2N / 2m。所以 N / m = 1 - X。现在我们可以把它们全部代进去了。</p><p>S: So now everything we have can be written in terms of X then.</p><p>S（中文）：这样现在所有东西都能用 X 表示了。</p><p>T: Exactly. So now we take our basic differential equation here—and of course, that should have been over m because we're going to be substituting it in—and now we can say: X-prime = K sub N to P × (N / m) - K sub P to N × (P / m)</p><p>T（中文）：正是。现在我们取前面那条基本微分方程——当然，分母应该是 m，因为我们要把它代进去——于是可以写出：X′ = K_NP × (N / m) - K_PN × (P / m)</p><p>But we said that K sub N to P is equal to V × e^(a × X), and that is going to be multiplied by N / m, which is 1 minus X. And then we have minus K sub P to N times P / m. Well, K sub P to N is V × e^(-a × X)—that's K sub P to N—and then P / m is 1 plus X.</p><p>但我们说过 K_NP = V × e^(a × X)，它要乘上 N / m，也就是 1 - X；然后还有减去 K_PN 乘 P / m 这一项。K_PN 是 V × e^(-a × X)，而 P / m 是 1 + X。</p><p>S: So the full equation is now given in one variable then.</p><p>S（中文）：于是整个方程现在就用一个变量表示出来了。</p><p>T: Correct. So look at what we have here. We have a differential equation in the single variable: X-prime = V × [(1 - X) × e^(aX) - (1 + X) × e^(-aX)]</p><p>T（中文）：没错。看看我们现在有什么：一个单变量的微分方程 X′ = V × [(1 - X) × e^(aX) - (1 + X) × e^(-aX)]</p><p>This is X, but we also have 2 constants and 2 parameters. This is a complete differential equation in terms of those parameters. And now the question is: what is this system going to do and what behavior does that predict? And it's hard, because those are very nonlinear equations. It's far from obvious what behavior is predicted.</p><p>这是关于 X 的，但其中还有 2 个常数和 2 个参数。这是一个关于这些参数的完整微分方程。现在的问题是：这个系统会怎么运作？它预言什么样的行为？这很难，因为这些都是非常非线性的方程，它到底预言什么行为远非一目了然。</p><p>But of course, what we're going to do first is find the equilibrium points—as always. So we know how to do that. We said X-prime equals zero—definition of an equilibrium point. So the first thing we know, if we set this equal to zero, the V drops out. We just divide by V.</p><p>当然，我们要做的第一件事照例是找平衡点。我们知道该怎么做：令 X′ 等于零——这是平衡点的定义。于是第一件事就清楚了：把它设为零后，V 就消掉了，直接除以 V 即可。</p><p>S: So by doing this, the equilibrium condition simplifies?</p><p>S（中文）：这样一做，平衡条件就简化了？</p><p>T: Correct. So now we're looking for places where: (1 - X) × e^(a X) = (1 + X) × e^(-aX)</p><p>T（中文）：没错。现在我们要找的是满足下式的位置：(1 - X) × e^(aX) = (1 + X) × e^(-aX)</p><p>And that's still hard. You can't solve that paper-and-pencil. Those are nasty nonlinear equations. But what we can do is use a graphing calculator and solve this graphically: plot these two and then ask where they intersect, or just plot them overall as a vector field.</p><p>这依然很难，用纸笔是解不出来的——这些是棘手的非线性方程。但我们可以用图形计算器，用图解法来解：把两条曲线画出来，问它们在哪里相交，或者干脆把它整体画成向量场。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image9.png\" /></p><p><em>Exhibit 2.9  The vector field X′ versus X for a = 0.8 (black), a = 1.5 (red) and a = 2.2 (blue), with the corresponding state-space arrow diagrams</em></p><p><em>展品 2.9  a = 0.8（黑）、a = 1.5（红）、a = 2.2（蓝）时的向量场（X′ 对 X），以及对应的状态空间箭头示意</em></p></td></tr></table><p>We are going to do it the second way. We're going to plot this vector field in a classic vector field diagram where we have X and X prime on our axes. Now we're going to take a couple of different values of the parameter a. For example, we’re going to let a equal 0.5, which is a bit of a bandwagon effect but not a gigantic one. When a is equal to 0.5, we graph this expression, and it looks like this: zero. And you see how many equilibrium points it has—namely, one. And then if we ask you: stable or unstable? You use the method of linearization. The slope there is negative and we therefore have a stable equilibrium point.</p><p>我们用第二种方法。我们要把这个向量场画在经典的向量场图上，坐标轴是 X 和 X′。接下来取几个不同的参数 a 值。比如，令 a = 0.5，有一点从众效应但不太大。a = 0.5 时我们把这个表达式画出来，它看起来是这样的：过零点。你可以看到它有多少个平衡点——只有一个。然后如果问你：稳定还是不稳定？用线性化方法：那里斜率为负，所以我们得到一个稳定平衡点。</p><p>S: So with weak bandwagon pressure, we must have a balanced stable state.</p><p>S（中文）：所以在较弱的从众压力下，一定有一个均衡的稳定状态。</p><p>T: Exactly. We want to point out that it's a stable equilibrium point at the value X equals zero. And remember that X is defined as the imbalance towards positivity. So when X equals zero, P equals N, which means the two opinions are equally balanced. That's what P equals N means: the number of P's is the same as the number of N's. P and N are equally balanced. That is a stable equilibrium point.</p><p>T（中文）：完全正确。要指出的是，在 X = 0 处是一个稳定平衡点。记住 X 定义为趋向正向的失衡度。所以当 X = 0 时，P = N，也就是两种意见正好均衡。这就是 P = N 的含义：P 的数量和 N 的数量相同，P 与 N 完全均衡。这是一个稳定平衡点。</p><p>The resulting state space is going to look like that—that's X state space with the vector field on it. There is the stable equilibrium. And what this says is: for this value of the strength of the bandwagon effect, there is going to be one stable equilibrium, and it's going to be at a balanced state where negatives and positives are equal.</p><p>由此得到的状态空间就像这样——这是带上向量场的 X 状态空间，那里就是稳定平衡。它说的是：对于这个从众效应强度值，系统将只有一个稳定平衡，而且位于正负相等的均衡状态上。</p><p>S: But what happens when the bandwagon effect gets stronger?</p><p>S（中文）：那当从众效应变强时会怎样？</p><p>T: Well let's ask: what happens for a different a? We’re now going to plot a equals 1.5 and 2.2. And when we plot a equals 1.5 and 2.2, we plot this equation—for a equals 1.5—we get a different shape of curve. The curves now looks like this.</p><p>T（中文）：我们来看看换一个 a 会怎样。现在我们画 a = 1.5 和 2.2。画 a = 1.5 时的这条方程，得到的曲线形状就不一样了。曲线现在看起来是这样。</p><p>S: Does the equilibrium structure change?</p><p>S（中文）：平衡点结构会改变吗？</p><p>T: Yes it does. And what does that say? Well, notice: how many equilibrium points we have for a equals 1.5 and 2.2? Well, we still have zero. But now we have two new equilibrium points: at positive X, and another one at negative X.</p><p>T（中文）：会的。这说明什么？注意看：a = 1.5 和 2.2 时我们有多少个平衡点？仍然有零点。但现在多了两个新的平衡点：一个在正 X 处，另一个在负 X 处。</p><p>And what has happened to the stability of the equilibrium points? Method of linearization: this slope is positive. That means that that equilibrium point is unstable.</p><p>那么平衡点的稳定性发生了什么？线性化方法：这里斜率为正，说明这个平衡点不稳定。</p><p>Let's redraw state space here. Now this is zero. The equilibrium point at zero has a positive slope—that means it's unstable. These two equilibrium points have a negative slope—that means that they are stable.</p><p>我们把状态空间重画在这里。这是零点。零点处的平衡点斜率为正——说明它不稳定。这两个平衡点斜率为负——说明它们是稳定的。</p><p>S: So the centre becomes unstable and the outer equilibria become stable then.</p><p>S（中文）：所以中心变得不稳定，而两侧的平衡变得稳定。</p><p>T: Exactly. So look at what we now have. We have an unstable equilibrium point at zero. The centre is now unstable. And instead, we have two new stable equilibrium points at all positive or all negative.</p><p>T（中文）：正是。看看我们现在有什么：零点处是一个不稳定平衡点，中心现在不稳定了；取而代之，我们有两个新的稳定平衡点，一个全正、一个全负。</p><p>So from the mathematical modeling point of view, we have come up with an interesting conclusion, which is:</p><p>从数学建模的角度，我们得到了一个有意思的结论，这就是：</p><p>If the bandwagon effect is weak, there is only a single equilibrium point, and it's stable. And that equilibrium point is a balanced opinion.</p><p>如果从众效应较弱，就只有一个平衡点，而且它是稳定的，这个平衡点对应均衡的意见。</p><p>If the bandwagon effect is strong—in particular, if a is bigger than 1—the centre is no longer stable. And now we have two extremes that are the only stable points of view—the only stable equilibria of the system.</p><p>如果从众效应较强——特别是当 a 大于 1 时——中心不再稳定。此时只剩下两个极端，它们是系统仅有的稳定观点——仅有的稳定平衡点。</p><p>Lux uses it as a model of a bubble—that is to say, all positives—or crash, which is the opposite, all negatives. If you have the slightest little imbalance towards negativity, the whole thing is going to go negative. If you have the slightest little imbalance towards positivity, the whole thing is going to go positive. So this is a model, as Lux uses it, of bubbles and crashes. But more generally speaking, we can view this as a model of the emergence of political polarization.</p><p>Lux 把它用作泡沫的模型——也就是全部为正——或者崩盘的模型，即相反的全部为负。只要你有一点点偏向负面的失衡，整个系统就会走向负；只要有一点点偏向正面的失衡，整个系统就会走向正。所以正如 Lux 的用法，这是关于泡沫与崩盘的模型。但更一般地说，我们可以把它看作政治极化出现的模型。</p><p>S: What has a model of the stock market to do with political polarisation?</p><p>S（中文）：一个股市模型和政治极化有什么关系？</p><p>T: Because what this model says is: you have this feedback term—a positive feedback term here—that is the term that says \"I want to be with the majority.\" What is the strength of my wanting to be with the majority? How much positive feedback is being given to me in my positive or negative attitude? One of the things you could say would increase the value of a is the emergence of cable TV. When there were only broadcasts, there was only the centre. There was only Walter Cronkite, and Walter Cronkite gave you the centre opinion. And the centre was stable. With the rise of cable TV, there is reinforcement of positive and negative attitudes. A becomes greater than one and now we have the emergence of political polarization explained purely structurally by the change in that parameter.</p><p>T（中文）：因为这个模型说的是：你有一个反馈项——这里是一个正反馈项——它说的是“我想和多数人站在一起”。我想和多数人站在一起的意愿有多强？我的正面或负面态度能获得多少正反馈？可以说，有线电视（cable TV）的出现就会使 a 的值增大。在只有广播的年代，只有中心，只有沃尔特·克朗凯特（Walter Cronkite），而克朗凯特给你的是中间派的观点，所以中心是稳定的。随着有线电视的兴起，正面和负面的态度都得到强化。a 变得大于 1，于是政治极化的出现就纯粹由这个参数的变化在结构上得到了解释。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image10.png\" /></p><p><em>Exhibit 2.10  From one stable equilibrium to three (S-U-S) as a grows past 1: the vector field X′ versus X, with the stability pattern of each case</em></p><p><em>展品 2.10  当 a 越过 1 时，从一个稳定平衡变为三个（S-U-S）：向量场（X′ 对 X）及各情形的稳定性格局</em></p></td></tr></table><p>So what has happened here mathematically is clearly a bifurcation. A parameter—namely, a—passed through a critical point and the number and stability of equilibrium points changed. That's the definition of a bifurcation.</p><p>所以这里在数学上发生的显然是一次分岔：参数——也就是 a——越过了某个临界点，平衡点的数量和稳定性发生了改变。这就是分岔的定义。</p><p>In particular, it changed from one stable at zero, to three: stable-unstable-stable. And that's for a greater than one. And so that clearly is a bifurcation.</p><p>具体地说，它从零点处的一个稳定平衡，变成了三个：稳定–不稳定–稳定。这是 a 大于 1 时的情形。所以这显然是一次分岔。</p><p>S: Which bifurcation is this?</p><p>S（中文）：这是哪种分岔？</p><p>T: Well you see the S-U-S: the stable-unstable-stable. And you remember that a little bit from saddle-node bifurcation. And you go, \"Oh, maybe this is a saddle-node bifurcation.\" But then you look closely and you see it isn't. Because in a saddle-node bifurcation, we ended up with an S-U-S, but the S was always stable. And then, as the parameter passed through the critical point—like in the lac operon—you had the birth of a new pair, and the new pair was the unstable and the stable. And that's how you got this.</p><p>T（中文）：你看这个 S-U-S：稳定–不稳定–稳定。你会觉得有点眼熟，想起鞍结分岔（saddle-node bifurcation），然后说：“哦，也许这是鞍结分岔。”但你仔细一看就会发现不是。因为在鞍结分岔里，我们最后也得到 S-U-S，但那个 S 始终保持稳定；当参数越过临界点时——就像乳糖操纵子（lac operon）那样——诞生了一对新平衡点，这对新点是一个不稳定加一个稳定，于是才有了那个图形。</p><p>S: How is this different though?</p><p>S（中文）：那这里的不同在哪儿？</p><p>T: Well this is very different. This is not the stable equilibrium remaining stable and a new pair is created. The configuration here is: the old stable equilibrium became unstable, flanked by two new stable equilibria. Those stable equilibria did not exist before the bifurcation. And the one that was stable has now become unstable. So this is a very different bifurcation.</p><p>T（中文）：这里非常不同。这不是“稳定平衡保持稳定、再诞生一对新点”的情形。这里的构型是：原来那个稳定平衡变成了不稳定，两侧各出现一个新的稳定平衡。这些稳定平衡在分岔之前并不存在，而原来稳定的那个现在变成了不稳定。所以这是一种非常不同的分岔。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image11.png\" /></p><p><em>Exhibit 2.11  The bifurcation diagram of the pitchfork bifurcation: for a &gt; 1 the stable equilibrium at zero becomes unstable (dashed) and two stable branches appear</em></p><p><em>展品 2.11  叉式分岔的分岔图：a &gt; 1 时零点处的稳定平衡失稳（虚线），并出现两个稳定分支</em></p></td></tr></table><p>Let's make the bifurcation diagram. So as you know, in a bifurcation diagram, we're going to put the parameter value there, and then we're going to put state space here and draw the location and stability of the equilibrium. For a less than 1, we have a single equilibrium at 0, and it is going to be stable. For a bigger than 1, the equilibrium at X equals 0 is now going to be unstable.</p><p>我们来画分岔图。如你所知，在分岔图中，我们把参数值放在这条轴上，把状态空间放在这里，并标出平衡点的位置和稳定性。a 小于 1 时，我们在 0 处有一个平衡点，而且它是稳定的。a 大于 1 时，X = 0 处的平衡点现在变得不稳定。</p><p>Conversely, you had no equilibria here—for a less than 1, you had no equilibria except that one stable one. But now, as a gets bigger than 1, we have a new pair of stable equilibria, as a gets larger and larger, that thing goes out more and more. The resulting bifurcation diagram is called a pitchfork bifurcation. It's called a pitchfork bifurcation because of a painting where the old couple is holding a pitchfork.</p><p>反过来说，这里你本来没有其他平衡点——a 小于 1 时，除了那一个稳定平衡之外没有别的平衡点。但现在，随着 a 变得大于 1，出现了一对新的稳定平衡；a 越来越大，这一对分支就张得越来越开。所得的分岔图被称为叉式分岔（pitchfork bifurcation）。之所以叫叉式分岔，是因为有一幅画：一对老夫妇手里拿着一把干草叉（pitchfork）。</p><p>In a pitchfork bifurcation, what happens is exactly what you see here: a stable equilibrium becomes unstable, and two stable equilibria are created on either side of the previously stable equilibrium point. This is a new kind of bifurcation called a pitchfork bifurcation.</p><p>在叉式分岔中，发生的事情正如你在这里看到的：一个稳定平衡变成不稳定，并在原先那个稳定平衡点的两侧产生了两个稳定平衡。这是一种新的分岔类型，叫做叉式分岔。</p>",
              "nodes": []
            },
            {
              "id": "modeling-life-l2-text-2",
              "title": "Transcritical Bifurcation",
              "type": "text",
              "mode": "lecture",
              "exhibitMode": "authored",
              "html": "<p><strong>2.2 Transcritical Bifurcation</strong></p><p><strong>2.2 跨临界分岔</strong></p><p>T: So there is one more bifurcation, and then we will have completed all the types of bifurcations that only involve equilibrium points. We've covered all of them. And it's a kind of bifurcation that occurs, for example, in the equation for the Allee effect.</p><p>T（中文）：还有一种分岔，讲完它，只涉及平衡点的各类分岔我们就全部讲完了，这些类型我们就都覆盖到了。这种分岔会出现在例如阿利效应（Allee effect）的方程中。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image12.png\" /></p><p><em>Exhibit 2.12  The Allee-effect model X′ = 0.1X(X/a − 1)(1 − X/k), with its terms explained</em></p><p><em>展品 2.12  阿利效应模型 X′ = 0.1X(X/a − 1)(1 − X/k) 及各项含义</em></p></td></tr></table><p>Now let's remind ourselves first of all what these terms mean. This is the birth term—that's a birth rate. We chose the value 0.1; it's the per capita birth rate. This is the carrying capacity or the crowding factor, where of course K is the carrying capacity. X over A minus 1 is the threshold effect of the minimum size that you need to be viable. If X is less than that minimum size, then this is less than 1, which means they're going to go back to 0. Whereas if X is bigger than A, then that's positive, and it means you're going to grow.</p><p>现在先来回顾一下这些项的含义。这是出生项——是一个出生率。我们取值 0.1，它是个体出生率。这是容纳量项，或者叫拥挤因子，当然 K 就是环境容纳量。X/a − 1 是阈值效应项，表示维持存活所需的最小规模。如果 X 小于这个最小规模，这一项就小于 1，意味着它们会退回 0；而如果 X 大于 A，它就是正的，意味着种群会增长。</p><p>S: So if this is describing say an animal population, it means that the population varies between a minimum and maximum size?</p><p>S（中文）：所以如果这是在描述一个动物种群，就是说种群数量会在一个最小规模和一个最大规模之间变动？</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image13.png\" /></p><p><em>Exhibit 2.13  State space with the Allee effect for a &lt; k: the equilibrium points at 0, a and k, with their stability</em></p><p><em>展品 2.13  a &lt; k 时阿利效应的状态空间：位于 0、a、k 的平衡点及其稳定性</em></p></td></tr></table><p>T: Yes. So if we look at this in state space: A is the threshold, K is the carrying capacity. If we examine the stability of the equilibrium points, you see that:</p><p>T（中文）：是的。放到状态空间里看：A 是阈值，K 是容纳量。如果考察各平衡点的稳定性，你会看到：</p><p>If it's less than A, the vector field is negative, because this is always positive (that term is always positive). If X is less than A, this term is negative, and this term is positive. So we've got positive, positive, negative—that's negative.</p><p>如果 X 小于 A，向量场是负的，因为这一项总是正的（那一项总为正）。X 小于 A 时，这一项为负，那一项为正。所以我们得到正、正、负——总体为负。</p><p>If X is bigger than A, this is positive. This is positive because it's less than K, and that's always positive. So the vector field there is positive.</p><p>如果 X 大于 A，这一项是正的。它为正是因为 X 小于 K，而那总是正的。所以那里的向量场是正的。</p><p>S: What about for large values of X?</p><p>S（中文）：那 X 很大的时候呢？</p><p>T: When X is bigger than K, X / K is bigger than 1, this term becomes negative, and we have a stable equilibrium point. 0 is unstable, A is unstable and K is stable. And that's the Allee effect. Now what we want to do is: we want to look at the effect of changing A. A is going to become a parameter, and we want to move it around. In particular, we had assumed that A is less than K. But now we want to consider the case in which A is actually bigger than K—in other words, the minimal cohort size necessary to grow, which is when A bigger than the carrying capacity of the environment.</p><p>T（中文）：当 X 大于 K 时，X / K 大于 1，这一项变成负的，我们就有一个稳定平衡点。0 不稳定，A 不稳定，K 稳定。这就是阿利效应。现在我们要做的是：考察改变 A 带来的影响。A 将成为一个参数，我们要移动它。特别是，我们此前假设 A 小于 K，但现在要考虑 A 实际上大于 K 的情形——换句话说，增长所需的最小群体规模超过了环境的容纳量。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image14.png\" /></p><p><em>Exhibit 2.14  State space with the Allee effect for a &gt; k: the equilibrium points at 0, k and a, with their stability</em></p><p><em>展品 2.14  a &gt; k 时阿利效应的状态空间：位于 0、k、a 的平衡点及其稳定性</em></p></td></tr></table><p>T: Well, the situation changes. Let's make our bifurcation diagram and our state space. Here is K, and here is A. A is now bigger than K. IIf X is less than K and therefore also less than A—X is less than K means that this is less than one, so this is positive. This is always positive. And if X is less than A, this is less than 1, minus 1—that's negative. It's positive, positive, negative—that's negative. Conversely, if X is between K and A, then X is bigger than K, so this becomes negative. This is still negative. Now we have positive, negative, negative—so this becomes positive. If X is bigger than A, this is positive, this is negative, this is positive, and we have a negative.</p><p>T（中文）：情况变了。我们来画分岔图和状态空间。这里是 K，这里是 A，现在 A 大于 K。若 X 小于 K（因而也小于 A）——X 小于 K 意味着这一项小于 1，所以它是正的；这一项总是正的。而 X 小于 A 时，这一项小于 1，减 1 之后——是负的。正、正、负——总体为负。反之，如果 X 介于 K 和 A 之间，那么 X 大于 K，这一项变成负的；这一项仍是负的。现在是正、负、负——所以总体变成正的。若 X 大于 A，这一项为正，这一项为负，这一项为正，我们得到负。</p><p>S: So stability changes as A moves past K then.</p><p>S（中文）：所以当 A 越过 K 时，稳定性就改变了。</p><p>T: Exactly. So now we have a funny situation: the carrying capacity is now unstable, because it's less than the minimum size necessary to survive—the minimum size, in terms of numbers, necessary to survive. So now we have a positive equilibrium, a stable equilibrium and an unstable equilibrium. And this is, as always, a stable equilibrium at zero.</p><p>T（中文）：正是。于是出现了一个有趣的局面：容纳量现在不稳定了，因为它低于存活所需的最小规模——按数量计算的、存活所必需的最小规模。现在我们有一个正平衡点、一个稳定平衡点和一个不稳定平衡点，而零点照例是一个稳定平衡。</p><p>S: So what does the bifurcation look like as A changes?</p><p>S（中文）：那么随着 A 变化，分岔看起来是什么样的？</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image15.png\" /></p><p><em>Exhibit 2.15  The two cases compared, a &lt; k and a &gt; k, each with its state-space arrow diagram</em></p><p><em>展品 2.15  两种情形对比：a &lt; k 与 a &gt; k，各自的状态空间箭头示意</em></p></td></tr></table><p>T: To answer this, we want to make a bifurcation diagram. So these are the two situations for the Allee effect. And, as we're varying this parameter A:</p><p>T（中文）：为了回答这个问题，我们要画分岔图。这就是阿利效应的两种情形。当我们改变参数 A 时：</p><p>If A is less than K, we have a stable equilibrium at K and the unstable threshold at A.</p><p>如果 A 小于 K，我们在 K 处有一个稳定平衡，在 A 处有不稳定的阈值。</p><p>If A is bigger than K, K is no longer a stable equilibrium, and the only stable equilibrium is going to be at A—which is larger than the carrying capacity of the environment.</p><p>如果 A 大于 K，K 不再是稳定平衡，唯一的稳定平衡将在 A 处——而它大于环境的容纳量。</p><p>That's bad news for that species, because the minimum population size for survival is bigger than the carrying capacity of the environment. In other words, you need a bigger population than the environment can support, so you are not going to do well.</p><p>对这个物种来说这是个坏消息，因为存活所需的最小种群规模大于环境的容纳量。换句话说，你需要比环境所能支撑的更大的种群，所以日子不会好过。</p><p>But now let's notice an interesting thing about the bifurcation that just occurred. And then we'll draw the bifurcation diagram.</p><p>但现在让我们注意一下刚刚发生的这次分岔的一个有趣之处。然后我们来画分岔图。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image16.png\" /></p><p><em>Exhibit 2.16  Definition of a bifurcation: a change in the number or stability of equilibrium points</em></p><p><em>展品2.16  分岔的定义：平衡点数量或稳定性的变化</em></p></td></tr></table><p>We define a bifurcation as a change in the number or stability of equilibrium points. And now we look at this and we say: well, how many equilibrium points did we have when A was less than K? Well, we had three. How many equilibrium points do we have when A is bigger than K? Well, we also have three. We haven't gained or lost equilibrium points, but their stability has changed.</p><p>我们把分岔定义为平衡点数量或稳定性的变化。现在来看这个例子：A 小于 K 时我们有多少个平衡点？三个。A 大于 K 时有多少个？也是三个。我们没有增加也没有丢失平衡点，但它们的稳定性改变了。</p><table><tr><td><p><img src=\"/courses/modeling-life/lesson-2-image17.png\" /></p><p><em>Exhibit 2.17  The transcritical bifurcation diagram: the equilibria X = k and X = a exchange stability at a = k (left: with vector field; right: stability marked)</em></p><p><em>展品 2.17  跨临界分岔图：平衡点 X = k 与 X = a 在 a = k 处交换稳定性（左：含向量场；右：标注稳定性）</em></p></td></tr></table><p>So let's make the bifurcation diagram. We're going to put the parameter A on that axis. And as always, on the y-axis, we're going to put the state space, X. So no matter what the value of A is, we will always have a stable equilibrium at zero. Now let's follow what happens as A increases. For A, we have to put the value K right there. Now, as A increases, you see that the location of the equilibrium point, the unstable equilibrium point at A, gets larger and larger. This is just going to increase linearly with A, until that point.</p><p>我们来画分岔图。把参数 A 放在这条轴上。照例，纵轴放状态空间 X。无论 A 取什么值，零点处总有一个稳定平衡。现在看 A 增大时会发生什么。A 这条轴上，K 的值要标在这里。随着 A 增大，你会看到平衡点的位置——A 处那个不稳定平衡点——越来越大，它会随 A 线性增大，直到那个点为止。</p><p>Now look at point K. That was always stable until A got bigger than K. When A got bigger than K, the A equilibrium becomes stable, and the K equilibrium becomes unstable.</p><p>现在看 K 这个点。在 A 小于 K 之前它始终稳定。当 A 大于 K 时，A 处的平衡变成稳定，而 K 处的平衡变成不稳定。</p><p>So now we have a new kind of bifurcation diagram, where this is always stable and doesn't change. But the two equilibrium points—X equals K and X equals A at the point A equals K, exchange their stability. A had been unstable and it's now stable. K had been stable; it's now unstable. And this is a new kind of bifurcation. It's called transcritical bifurcation. With saddle-node bifurcation, pitchfork bifurcation, and now transcritical bifurcation, we have now covered all the bifurcations that can occur that involving only equilibrium points.</p><p>于是我们有了一种新的分岔图：这一支始终稳定、不改变，但两个平衡点——X = K 与 X = A——在 A = K 这一点交换了稳定性。A 原本不稳定，现在稳定；K 原本稳定，现在不稳定。这是一种新的分岔类型，叫做跨临界分岔（transcritical bifurcation）。有了鞍结分岔、叉式分岔，再加上现在的跨临界分岔，只涉及平衡点、可能发生的所有分岔类型我们就都讲完了。</p>",
              "nodes": []
            },
            {
              "id": "modeling-life-l2-video-1",
              "title": "Pitchfork Bifurcation in a Model of Public Opinion",
              "type": "video",
              "mode": "lecture",
              "url": "/api/course-media/modeling-life/613a07b1-24e8-4123-ab10-5bd36875293e",
              "startSeconds": 10,
              "exhibitMode": "authored",
              "nodes": []
            },
            {
              "id": "modeling-life-l2-video-2",
              "title": "Transcritical Bifurcation",
              "type": "video",
              "mode": "lecture",
              "url": "/api/course-media/modeling-life/613a07b1-24e8-4123-ab10-5bd36875293e",
              "startSeconds": 1204,
              "exhibitMode": "authored",
              "nodes": []
            }
          ],
          "assessments": {
            "knowledge": [],
            "application": null
          },
          "exploration": {
            "readings": [],
            "exhibits": []
          }
        }
      ]
    }
  ],
  "createdAt": "",
  "updatedAt": ""
} as ProductCourse;

export function modelingLifeCourse(createdAt: string): ProductCourse {
  const course = structuredClone(sourceCourse);
  course.createdAt = createdAt; course.updatedAt = createdAt;
  for (const section of course.sections) for (const lesson of section.lessons) {
    lesson.contents = validateLessonContents(lesson.contents, course.id, { allowExternalMedia: true });
  }
  return course;
}

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  const existing = courses.find(course => course.id === "modeling-life" || course.slug === "modeling-life");
  if (existing.length) {
    if (existing.length !== 1 || existing[0].id !== "modeling-life" || existing[0].slug !== "modeling-life") throw new Error("Modeling life course identity conflict; no course was overwritten.");
    const current = existing[0];
    const lessons = current.sections.flatMap(section => section.lessons);
    // Upgrade only the shipped whole-Lesson template. Authored/operator content
    // with any other identities is not overwritten by rerunning this seed.
    const legacy = lessons.length === 2 && [1, 2].every(number => {
      const lesson = lessons.find(item => item.id === `modeling-life-lesson-${number}`);
      return lesson?.contents?.length === 2 && ["text", "video"].every(type => lesson.contents!.some(point => point.id === `${lesson.id}-${type}` && point.type === type));
    });
    if (legacy) {
      const next = modelingLifeCourse(ctx.now), authored = next.sections.flatMap(section => section.lessons);
      courses.update(current.id, {
        subtitle: current.subtitle || next.subtitle,
        description: current.description.replace(/[\u2018\u2019]/g, "'") === next.subtitle?.replace(/[\u2018\u2019]/g, "'") ? next.description : current.description,
        outcomes: current.outcomes ?? next.outcomes, features: current.features ?? next.features,
        cover: next.cover, thumbnailPath: next.thumbnailPath,
        sections: current.sections.map(section => ({ ...section, lessons: section.lessons.map(lesson => ({ ...lesson, ...authored.find(item => item.id === lesson.id)!, title: lesson.title, summary: lesson.summary })) })),
        updatedAt: new Date(Math.max(Date.parse(ctx.now), Date.parse(current.updatedAt) + 1)).toISOString(),
      });
      return [{ action: "update", kind: "course", id: current.id }];
    }
    return [{ action: "skip", kind: "course", id: "modeling-life", reason: "exists" }];
  }
  courses.insert(modelingLifeCourse(ctx.now));
  return [{ action: "add", kind: "course", id: "modeling-life" }];
}
